// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirPool} from "../MimirPool.sol";

/**
 * MimirPool unit tests. Dependency-free (own cheatcode interface), absolute
 * timestamps throughout (via-IR can cache block.timestamp across vm.warp).
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

/// Stand-in for an ERC-4337 account: calls come from it, value lands in a light receive().
contract PoolAccount {
    address public immutable owner;
    bool public refuse;

    constructor(address _owner) {
        owner = _owner;
    }

    receive() external payable {
        if (refuse) revert("account paused");
    }

    function setRefuse(bool r) external {
        require(msg.sender == owner, "not owner");
        refuse = r;
    }

    function execute(address target, uint256 value, bytes calldata data) external returns (bytes memory ret) {
        require(msg.sender == owner, "not owner");
        bool ok;
        (ok, ret) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

/// Re-enters claimFor from its receive(): either under the push stipend, or
/// (refusing the push so its payout is parked) from withdraw() with all gas.
contract ReentrantClaimer {
    MimirPool immutable pool;
    uint256 public id;
    address public victim;
    bool public refuse;

    struct Seen {
        bool armed;
        bool called;
        bool reentered;
        bool stoppedByLock;
    }
    Seen public seen;

    constructor(MimirPool _pool) {
        pool = _pool;
        seen.armed = true;
    }

    function setup(uint256 _id, address _victim, bool _refuse) external {
        id = _id;
        victim = _victim;
        refuse = _refuse;
    }

    function setRefuse(bool r) external {
        refuse = r;
    }

    function stakeOn(uint256 _id, uint8 side) external payable {
        pool.stake{value: msg.value}(_id, side);
    }

    function pull() external {
        pool.withdraw();
    }

    receive() external payable {
        if (refuse) revert("not now");
        Seen memory s = seen;
        if (!s.armed) return;
        s.armed = false;
        s.called = true;
        (bool ok, bytes memory ret) =
            address(pool).call(abi.encodeWithSelector(MimirPool.claimFor.selector, id, victim));
        s.reentered = ok;
        s.stoppedByLock = keccak256(ret) == keccak256(abi.encodeWithSelector(MimirPool.Reentrant.selector));
        seen = s;
    }
}

contract MimirPoolTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirPool pool;
    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address keeper = address(0xB0B);
    address alice = address(0xA11CE);
    address carol = address(0xCA201);

    PoolAccount maker;
    PoolAccount taker;
    PoolAccount third;

    uint256 constant ONE = 1e18;
    uint16 constant FEE_BPS = 500; // 5% of profit
    uint256 constant WINDOW = 1 hours;
    uint256 constant T0 = 1_000_000;
    uint256 constant DEADLINE = T0 + 1 days;
    uint256 constant AFTER = DEADLINE + 1;

    uint8 constant A = 1;
    uint8 constant B = 2;
    uint8 constant DRAW = 3;
    uint8 constant UNRESOLVABLE = 4;

    function setUp() public {
        vm.warp(T0);
        pool = new MimirPool(oracle, FEE_BPS, platform, WINDOW);
        maker = new PoolAccount(address(this));
        taker = new PoolAccount(address(this));
        third = new PoolAccount(address(this));
        vm.deal(address(maker), 100 * ONE);
        vm.deal(address(taker), 100 * ONE);
        vm.deal(address(third), 100 * ONE);
        vm.deal(alice, 100 * ONE);
        vm.deal(carol, 100 * ONE);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _createAs(PoolAccount acct, uint256 amount, uint8 side) internal returns (uint256 id) {
        bytes memory ret = acct.execute(address(pool), amount, abi.encodeWithSelector(
            MimirPool.createMarket.selector, "Will it?", "YES", "NO", "https://example.com", "custom", DEADLINE, side
        ));
        id = abi.decode(ret, (uint256));
    }

    function _create(address who, uint256 amount, uint8 side) internal returns (uint256 id) {
        vm.prank(who);
        id = pool.createMarket{value: amount}("Will it?", "YES", "NO", "https://example.com", "custom", DEADLINE, side);
    }

    function _stakeAs(PoolAccount acct, uint256 id, uint256 amount, uint8 side) internal {
        acct.execute(address(pool), amount, abi.encodeWithSelector(MimirPool.stake.selector, id, side));
    }

    function _stake(address who, uint256 id, uint256 amount, uint8 side) internal {
        vm.prank(who);
        pool.stake{value: amount}(id, side);
    }

    function _propose(uint256 id, uint8 outcome) internal {
        vm.warp(AFTER);
        vm.prank(oracle);
        pool.resolve(id, outcome, "proposed", bytes32(uint256(1)));
    }

    function _settle(uint256 id, uint8 outcome) internal {
        _propose(id, outcome);
        vm.warp(AFTER + WINDOW);
        pool.finalize(id);
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,, state,,,,,) = pool.getMarket(id);
    }

    function _err(bytes4 sel) internal pure returns (bytes32) {
        return keccak256(abi.encodeWithSelector(sel));
    }

    function _claimCall(uint256 id, address user) internal returns (bool ok, bytes memory ret) {
        (ok, ret) = address(pool).call(abi.encodeWithSelector(MimirPool.claimFor.selector, id, user));
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    function test_fullLifecycleWithSmartAccounts() public {
        uint256 id = _createAs(maker, 10 * ONE, A);
        _stakeAs(maker, id, 5 * ONE, A); // stakes add up
        _stakeAs(taker, id, 20 * ONE, B);
        _stakeAs(third, id, 5 * ONE, A);

        (uint256 onA, uint256 onB) = pool.stakeOf(id, address(maker));
        assert(onA == 15 * ONE && onB == 0);
        (uint256 totalA, uint256 totalB) = pool.sideTotals(id);
        assert(totalA == 20 * ONE && totalB == 20 * ONE);

        _propose(id, A);
        assert(_state(id) == pool.ST_PROPOSED());
        (bool early,) = address(pool).call(abi.encodeWithSelector(MimirPool.finalize.selector, id));
        assert(!early);
        vm.warp(AFTER + WINDOW);
        vm.prank(keeper);
        pool.finalize(id);
        assert(_state(id) == pool.ST_RESOLVED());

        // maker: 15 back + 15 profit - 5% of 15.
        (uint256 owed, uint256 fee) = pool.claimable(id, address(maker));
        assert(owed == 2925 * ONE / 100 && fee == 75 * ONE / 100);
        maker.execute(address(pool), 0, abi.encodeWithSelector(MimirPool.claim.selector, id));
        third.execute(address(pool), 0, abi.encodeWithSelector(MimirPool.claim.selector, id));
        assert(address(maker).balance == 85 * ONE + 2925 * ONE / 100);
        assert(address(third).balance == 95 * ONE + 975 * ONE / 100);

        // The loser has nothing to claim; nobody claims twice.
        (bool lost, bytes memory r1) = _claimCall(id, address(taker));
        assert(!lost && keccak256(r1) == _err(MimirPool.NothingToClaim.selector));
        (bool twice, bytes memory r2) = _claimCall(id, address(maker));
        assert(!twice && keccak256(r2) == _err(MimirPool.AlreadyClaimed.selector));

        // What is left is exactly the fee, which the platform pulls.
        assert(address(pool).balance == ONE && pool.accruedFees(platform) == ONE);
        vm.prank(platform);
        pool.claimFees();
        assert(address(pool).balance == 0);
    }

    function test_sideBWinsKeeperPushesAndDustStaysInThePot() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stakeAs(maker, id, 3 * ONE, B);
        _stakeAs(taker, id, 4 * ONE, B);
        _settle(id, B);

        uint256 pot = 17 * ONE;
        uint256 paid;
        uint256 makerBefore = address(maker).balance;
        uint256 takerBefore = address(taker).balance;
        vm.prank(keeper); // anyone pushes to the accounts
        pool.claimFor(id, address(maker));
        vm.prank(keeper);
        pool.claimFor(id, address(taker));
        paid = (address(maker).balance - makerBefore) + (address(taker).balance - takerBefore);

        // 10/7 does not divide: profits round down, the remainder stays.
        assert(address(maker).balance - makerBefore >= 3 * ONE);
        assert(address(taker).balance - takerBefore >= 4 * ONE);
        assert(paid + pool.accruedFees(platform) <= pot);
        assert(address(pool).balance == pot - paid);
        assert(address(pool).balance >= pool.accruedFees(platform));
        assert(address(pool).balance - pool.accruedFees(platform) <= 2); // at most 1 wei per winner
    }

    function test_anEmptyLosingSideRefundsEveryoneInFull() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 4 * ONE, A);
        _settle(id, A);

        pool.claimFor(id, alice);
        pool.claimFor(id, carol);
        assert(alice.balance == 100 * ONE && carol.balance == 100 * ONE);
        assert(pool.lifetimeFeesAccrued() == 0 && address(pool).balance == 0);
    }

    function test_anEmptyWinningSideRefundsEveryoneInFull() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 4 * ONE, A);
        _settle(id, B); // nobody backed B

        pool.claimFor(id, alice);
        pool.claimFor(id, carol);
        assert(alice.balance == 100 * ONE && carol.balance == 100 * ONE);
        assert(pool.lifetimeFeesAccrued() == 0);
    }

    function test_aDrawRefundsBothSidesWithoutFee() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 6 * ONE, B);
        _stake(alice, id, 3 * ONE, B); // a hedger gets both legs back
        _settle(id, DRAW);

        pool.claimFor(id, alice);
        pool.claimFor(id, carol);
        assert(alice.balance == 100 * ONE && carol.balance == 100 * ONE);
        assert(pool.lifetimeFeesAccrued() == 0 && address(pool).balance == 0);
    }

    function test_aHedgerOnBothSidesIsPaidOnlyTheWinningLeg() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(alice, id, 10 * ONE, B);
        _stake(carol, id, 10 * ONE, B);
        _settle(id, A);

        // Alice's 10 on A wins all 20 on B (her own 10 included): profit 20, fee 1.
        pool.claimFor(id, alice);
        assert(alice.balance == 80 * ONE + 30 * ONE - ONE);
    }

    // ── Disputes ────────────────────────────────────────────────────────────

    function _disputed() internal returns (uint256 id) {
        id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        _propose(id, A);
        vm.prank(carol);
        pool.dispute{value: 2 * ONE}(id);
        assert(_state(id) == pool.ST_DISPUTED());
    }

    function test_aRightDisputeFlipsTheVerdictAndReturnsTheBond() public {
        uint256 id = _disputed();
        (bool fin,) = address(pool).call(abi.encodeWithSelector(MimirPool.finalize.selector, id));
        assert(!fin);

        pool.resolveDispute(id, B, "arbiter", bytes32(uint256(2)));
        assert(carol.balance == 90 * ONE); // bond back
        pool.claimFor(id, carol);
        // 10 back + 10 profit - 5% of 10.
        assert(carol.balance == 90 * ONE + 20 * ONE - ONE / 2);
    }

    function test_aWrongDisputeForfeitsTheBondToThePlatform() public {
        uint256 id = _disputed();
        pool.resolveDispute(id, A, "upheld", bytes32(uint256(1)));
        assert(pool.accruedFees(platform) == 2 * ONE);
        assert(carol.balance == 88 * ONE);
    }

    function test_onlyParticipantsDisputeWithTheExactBondAndInTime() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        _propose(id, A);

        vm.deal(keeper, 10 * ONE);
        vm.prank(keeper);
        (bool stranger, bytes memory r1) =
            address(pool).call{value: 2 * ONE}(abi.encodeWithSelector(MimirPool.dispute.selector, id));
        assert(!stranger && keccak256(r1) == _err(MimirPool.NotParticipant.selector));

        vm.prank(carol);
        (bool cheap, bytes memory r2) =
            address(pool).call{value: ONE}(abi.encodeWithSelector(MimirPool.dispute.selector, id));
        assert(!cheap && keccak256(r2) == _err(MimirPool.WrongBond.selector));

        vm.warp(AFTER + WINDOW);
        vm.prank(carol);
        (bool late, bytes memory r3) =
            address(pool).call{value: 2 * ONE}(abi.encodeWithSelector(MimirPool.dispute.selector, id));
        assert(!late && keccak256(r3) == _err(MimirPool.WindowClosed.selector));
    }

    function test_onlyTheArbiterRules() public {
        uint256 id = _disputed();
        vm.prank(oracle);
        (bool ok, bytes memory r) = address(pool).call(
            abi.encodeWithSelector(MimirPool.resolveDispute.selector, id, B, "x", bytes32(0))
        );
        assert(!ok && keccak256(r) == _err(MimirPool.NotOwner.selector));
    }

    // ── Escape hatch and late verdicts ──────────────────────────────────────

    function test_anUnresolvedMarketIsRefundedAfterTheGrace() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 6 * ONE, B);

        vm.warp(DEADLINE + pool.RESOLUTION_GRACE_SECONDS() - 1);
        (bool early, bytes memory r) = address(pool).call(abi.encodeWithSelector(MimirPool.refundExpired.selector, id));
        assert(!early && keccak256(r) == _err(MimirPool.GraceNotOver.selector));

        vm.warp(DEADLINE + pool.RESOLUTION_GRACE_SECONDS());
        vm.prank(keeper);
        pool.refundExpired(id);
        (,,,, uint8 outcome,,,,) = pool.getMarket(id);
        assert(outcome == UNRESOLVABLE);
        pool.claimFor(id, alice);
        pool.claimFor(id, carol);
        assert(alice.balance == 100 * ONE && carol.balance == 100 * ONE);
    }

    function test_anUnruledDisputeIsRefundedAndTheBondIsKept() public {
        uint256 id = _disputed();
        vm.warp(AFTER + pool.RESOLUTION_GRACE_SECONDS());
        pool.refundExpired(id);
        pool.claimFor(id, carol);
        assert(carol.balance == 98 * ONE); // stake back, bond kept
        assert(pool.accruedFees(platform) == 2 * ONE);
    }

    function test_aLateOracleVerdictReverts() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 6 * ONE, B);
        vm.warp(DEADLINE + pool.RESOLUTION_GRACE_SECONDS());
        vm.prank(oracle);
        (bool ok, bytes memory r) = address(pool).call(
            abi.encodeWithSelector(MimirPool.resolve.selector, id, A, "late", bytes32(0))
        );
        assert(!ok && keccak256(r) == _err(MimirPool.GraceOver.selector));
    }

    function test_aLateArbiterRulingReverts() public {
        uint256 id = _disputed();
        vm.warp(AFTER + pool.RESOLUTION_GRACE_SECONDS());
        (bool ok, bytes memory r) = address(pool).call(
            abi.encodeWithSelector(MimirPool.resolveDispute.selector, id, B, "late", bytes32(0))
        );
        assert(!ok && keccak256(r) == _err(MimirPool.GraceOver.selector));
    }

    function test_noVerdictBeforeTheDeadline() public {
        uint256 id = _create(alice, 10 * ONE, A);
        vm.prank(oracle);
        (bool ok, bytes memory r) = address(pool).call(
            abi.encodeWithSelector(MimirPool.resolve.selector, id, A, "early", bytes32(0))
        );
        assert(!ok && keccak256(r) == _err(MimirPool.NotExpired.selector));
    }

    // ── Reentrancy ──────────────────────────────────────────────────────────

    function _reentrancyMarket(ReentrantClaimer attacker) internal returns (uint256 id) {
        vm.deal(address(attacker), 10 * ONE);
        id = _create(alice, 10 * ONE, A);
        attacker.stakeOn{value: 5 * ONE}(id, A);
        _stake(carol, id, 10 * ONE, B);
        _settle(id, A);
    }

    function test_aClaimCannotBeReenteredUnderThePushStipend() public {
        ReentrantClaimer attacker = new ReentrantClaimer(pool);
        uint256 id = _reentrancyMarket(attacker);
        attacker.setup(id, alice, false);

        pool.claimFor(id, address(attacker));
        (, bool called, bool reentered, bool stoppedByLock) = attacker.seen();
        assert(called && !reentered && stoppedByLock);
        assert(!pool.claimed(id, alice));
    }

    function test_aClaimCannotBeReenteredFromAFullGasWithdraw() public {
        ReentrantClaimer attacker = new ReentrantClaimer(pool);
        uint256 id = _reentrancyMarket(attacker);
        attacker.setup(id, alice, true); // refuse the push, so the payout is parked

        pool.claimFor(id, address(attacker));
        uint256 parked = pool.pendingWithdrawals(address(attacker));
        assert(parked > 0);

        attacker.setRefuse(false);
        attacker.pull(); // all gas forwarded: only the lock can stop the re-entry
        (, bool called, bool reentered, bool stoppedByLock) = attacker.seen();
        assert(called && !reentered && stoppedByLock);
        assert(pool.pendingWithdrawals(address(attacker)) == 0);
        assert(!pool.claimed(id, alice));
    }

    // ── Fees ────────────────────────────────────────────────────────────────

    function test_theFeeIsFrozenAtCreation() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        pool.queueFeePolicy(1_000, platform);
        vm.warp(T0 + pool.TIMELOCK_SECONDS());
        pool.executeFeePolicy();
        assert(pool.feeBps() == 1_000);

        _settle(id, A);
        (, uint256 fee) = pool.claimable(id, alice);
        assert(fee == (10 * ONE * FEE_BPS) / 10_000);
    }

    function test_theFeeCapHolds() public {
        (bool ok, bytes memory r) =
            address(pool).call(abi.encodeWithSelector(MimirPool.queueFeePolicy.selector, uint16(1_001), platform));
        assert(!ok && keccak256(r) == _err(MimirPool.FeeTooHigh.selector));
    }

    /// Any stakes, any fee the cap allows: a winner gets at least their stake,
    /// and the market never pays out more than it took in.
    function testFuzz_winnersKeepTheirStakeAndThePotHolds(
        uint96 rawA1,
        uint96 rawA2,
        uint96 rawB,
        uint16 rawFee,
        bool aWins
    ) public {
        uint256 a1 = 2 * ONE + (uint256(rawA1) % (1_000 * ONE));
        uint256 a2 = 2 * ONE + (uint256(rawA2) % (1_000 * ONE));
        uint256 b = 2 * ONE + (uint256(rawB) % (1_000 * ONE));
        MimirPool p = new MimirPool(oracle, uint16(rawFee % 1_001), platform, 0);
        vm.deal(alice, a1);
        vm.deal(carol, a2);
        vm.deal(keeper, b);

        vm.prank(alice);
        uint256 id = p.createMarket{value: a1}("q", "Y", "N", "u", "c", DEADLINE, A);
        vm.prank(carol);
        p.stake{value: a2}(id, A);
        vm.prank(keeper);
        p.stake{value: b}(id, B);

        vm.warp(AFTER);
        vm.prank(oracle);
        p.resolve(id, aWins ? A : B, "v", bytes32(0));

        if (aWins) {
            p.claimFor(id, alice);
            p.claimFor(id, carol);
        } else {
            p.claimFor(id, keeper);
        }
        if (aWins) {
            assert(alice.balance >= a1 && carol.balance >= a2 && keeper.balance == 0);
        } else {
            assert(keeper.balance >= b && alice.balance == 0 && carol.balance == 0);
        }
        uint256 paid = alice.balance + carol.balance + keeper.balance;
        assert(paid + p.accruedFees(platform) <= a1 + a2 + b);
        assert(address(p).balance == a1 + a2 + b - paid);
    }

    // ── Staking rules, pause, parking, admin ────────────────────────────────

    function test_stakingClosesBeforeTheDeadline() public {
        uint256 id = _create(alice, 10 * ONE, A);
        vm.warp(DEADLINE - pool.LOCK_SECONDS() + 1);
        vm.prank(carol);
        (bool ok, bytes memory r) =
            address(pool).call{value: 2 * ONE}(abi.encodeWithSelector(MimirPool.stake.selector, id, B));
        assert(!ok && keccak256(r) == _err(MimirPool.BettingClosed.selector));
    }

    function test_stakesBelowTheMinimumOrOnNoSideAreRefused() public {
        uint256 id = _create(alice, 10 * ONE, A);
        vm.prank(carol);
        (bool small,) = address(pool).call{value: ONE}(abi.encodeWithSelector(MimirPool.stake.selector, id, B));
        vm.prank(carol);
        (bool noSide,) = address(pool).call{value: 2 * ONE}(abi.encodeWithSelector(MimirPool.stake.selector, id, 3));
        assert(!small && !noSide);
    }

    function test_pauseStopsStakesButNeverSettlementOrClaims() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        pool.setPaused(true);

        vm.prank(carol);
        (bool staked,) = address(pool).call{value: 2 * ONE}(abi.encodeWithSelector(MimirPool.stake.selector, id, B));
        assert(!staked);

        _settle(id, B);
        pool.claimFor(id, carol);
        assert(carol.balance > 90 * ONE);
        vm.prank(platform);
        pool.claimFees();
    }

    function test_aRefusedPushIsParkedAndPulledLater() public {
        uint256 id = _createAs(maker, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        _settle(id, A);

        maker.setRefuse(true);
        pool.claimFor(id, address(maker));
        uint256 parked = pool.pendingWithdrawals(address(maker));
        assert(parked == 20 * ONE - ONE / 2);

        maker.setRefuse(false);
        maker.execute(address(pool), 0, abi.encodeWithSelector(MimirPool.withdraw.selector));
        assert(address(maker).balance == 90 * ONE + parked);
    }

    function test_adminChangesAreTimelocked() public {
        pool.transferOwnership(alice);
        pool.queueOracle(carol);
        vm.prank(alice);
        (bool earlyOwner,) = address(pool).call(abi.encodeWithSelector(MimirPool.acceptOwnership.selector));
        (bool earlyOracle,) = address(pool).call(abi.encodeWithSelector(MimirPool.executeOracle.selector));
        assert(!earlyOwner && !earlyOracle);

        vm.warp(T0 + pool.TIMELOCK_SECONDS());
        pool.executeOracle();
        vm.prank(alice);
        pool.acceptOwnership();
        assert(pool.owner() == alice && pool.oracle() == carol);
    }

    function test_strangersCannotAdminister() public {
        vm.prank(keeper);
        (bool a,) = address(pool).call(abi.encodeWithSelector(MimirPool.setPaused.selector, true));
        vm.prank(keeper);
        (bool b,) = address(pool).call(abi.encodeWithSelector(MimirPool.queueOracle.selector, keeper));
        assert(!a && !b);
    }

    function test_plainTransfersAreRefused() public {
        (bool ok,) = address(pool).call{value: ONE}("");
        assert(!ok);
    }
}
