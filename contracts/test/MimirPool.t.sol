// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirPool, IMimirFees} from "../MimirPool.sol";
import {MimirFees} from "../MimirFees.sol";
import {FlatFees} from "./FlatFees.sol";

/**
 * MimirPool unit tests. Dependency-free (own cheatcode interface), absolute
 * timestamps throughout (via-IR can cache block.timestamp across vm.warp).
 * The mechanics run with no entry fee (FlatFees(0)) so amounts stay round;
 * the "Fees" section uses the real MimirFees.
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
        pool.stake{value: msg.value}(_id, side, address(0));
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
        pool = new MimirPool(address(this), address(this), oracle, platform, IMimirFees(address(new FlatFees(0))), WINDOW, 2e18);
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
            MimirPool.createMarket.selector, "Will it?", "YES", "NO", "https://example.com", "custom", DEADLINE, side, address(0)
        ));
        id = abi.decode(ret, (uint256));
    }

    function _create(address who, uint256 amount, uint8 side) internal returns (uint256 id) {
        vm.prank(who);
        id = pool.createMarket{value: amount}("Will it?", "YES", "NO", "https://example.com", "custom", DEADLINE, side, address(0));
    }

    function _stakeAs(PoolAccount acct, uint256 id, uint256 amount, uint8 side) internal {
        acct.execute(address(pool), amount, abi.encodeWithSelector(MimirPool.stake.selector, id, side, address(0)));
    }

    function _stake(address who, uint256 id, uint256 amount, uint8 side) internal {
        vm.prank(who);
        pool.stake{value: amount}(id, side, address(0));
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
        (,,, state,,,) = pool.getMarket(id);
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

        // maker: 15 back + 15 profit, no fee on winnings.
        (uint256 owed, uint256 fee) = pool.claimable(id, address(maker));
        assert(owed == 30 * ONE && fee == 0);
        maker.execute(address(pool), 0, abi.encodeWithSelector(MimirPool.claim.selector, id));
        third.execute(address(pool), 0, abi.encodeWithSelector(MimirPool.claim.selector, id));
        assert(address(maker).balance == 85 * ONE + 30 * ONE);
        assert(address(third).balance == 95 * ONE + 10 * ONE);

        // The loser has nothing to claim; nobody claims twice.
        (bool lost, bytes memory r1) = _claimCall(id, address(taker));
        assert(!lost && keccak256(r1) == _err(MimirPool.NothingToClaim.selector));
        (bool twice, bytes memory r2) = _claimCall(id, address(maker));
        assert(!twice && keccak256(r2) == _err(MimirPool.AlreadyClaimed.selector));

        // Everything was paid out.
        assert(address(pool).balance == 0 && pool.accruedFees(platform) == 0);
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

        // Alice's 10 on A wins all 20 on B (her own 10 included): 30 back.
        pool.claimFor(id, alice);
        assert(alice.balance == 80 * ONE + 30 * ONE);
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
        // 10 back + 10 profit.
        assert(carol.balance == 90 * ONE + 20 * ONE);
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
        // Disputes are ruled by the arbiter role (owner and arbiter are separate since the 2026-10-08 hardening).
        assert(!ok && keccak256(r) == _err(MimirPool.NotArbiter.selector));
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
        (,,,, uint8 outcome,,) = pool.getMarket(id);
        assert(outcome == UNRESOLVABLE);
        pool.claimFor(id, alice);
        pool.claimFor(id, carol);
        assert(alice.balance == 100 * ONE && carol.balance == 100 * ONE);
    }

    function test_anUnruledDisputeSettlesToTheProposalAndForfeitsTheBond() public {
        uint256 id = _disputed(); // proposed A; carol (B) disputed
        vm.warp(AFTER + pool.RESOLUTION_GRACE_SECONDS());
        pool.refundExpired(id);
        assert(_state(id) == pool.ST_RESOLVED());
        (uint256 alicePay,) = pool.claimable(id, alice);
        (uint256 carolPay,) = pool.claimable(id, carol);
        assert(alicePay == 20 * ONE && carolPay == 0); // the proposal stands
        assert(pool.accruedFees(platform) == 2 * ONE); // bond forfeited
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

    // ── Fees (the real MimirFees: 0.5% entry; copy trades 1% + 1% of profit) ──

    address ref = address(0x5EF);

    function _feePool() internal returns (MimirPool p) {
        p = new MimirPool(address(this), address(this), oracle, platform, IMimirFees(address(new MimirFees(address(this), address(0x5161)))), 0, 2e18);
    }

    function _net(uint256 amount) internal pure returns (uint256) {
        return amount - (amount * 50) / 10_000;
    }

    function test_everyStakePaysTheEntryFee() public {
        MimirPool p = _feePool();
        vm.prank(alice);
        uint256 id = p.createMarket{value: 10 * ONE}("q", "Y", "N", "u", "c", DEADLINE, A, address(0));
        vm.prank(carol);
        p.stake{value: 4 * ONE}(id, B, address(0));

        (uint256 onA,) = p.stakeOf(id, alice);
        (, uint256 onB) = p.stakeOf(id, carol);
        assert(onA == _net(10 * ONE) && onB == _net(4 * ONE));
        assert(p.accruedFees(platform) == 14 * ONE - _net(10 * ONE) - _net(4 * ONE));
    }

    function test_aRefundReturnsTheNetStakeAndKeepsTheFee() public {
        MimirPool p = _feePool();
        vm.prank(alice);
        uint256 id = p.createMarket{value: 10 * ONE}("q", "Y", "N", "u", "c", DEADLINE, A, address(0));
        vm.warp(AFTER);
        vm.prank(oracle);
        p.resolve(id, DRAW, "v", bytes32(0));
        p.claimFor(id, alice);
        assert(alice.balance == 90 * ONE + _net(10 * ONE));
        assert(address(p).balance == p.accruedFees(platform));
    }

    function test_aWinningCopyTradePaysOnePercentEachOnProfit() public {
        MimirPool p = _feePool();
        vm.prank(alice);
        uint256 id = p.createMarket{value: 10 * ONE}("q", "Y", "N", "u", "c", DEADLINE, A, ref);
        vm.prank(carol);
        p.stake{value: 10 * ONE}(id, B, address(0));
        vm.warp(AFTER);
        vm.prank(oracle);
        p.resolve(id, A, "v", bytes32(0));

        uint256 profit = _net(10 * ONE);
        (uint256 payout, uint256 fee) = p.claimable(id, alice);
        assert(fee == 2 * ((profit * 100) / 10_000));
        p.claimFor(id, alice);
        assert(alice.balance == 90 * ONE + 2 * _net(10 * ONE) - fee && payout == 2 * _net(10 * ONE) - fee);
        assert(p.accruedFees(ref) == (profit * 100) / 10_000);
        assert(address(p).balance == p.accruedFees(platform) + p.accruedFees(ref));
    }

    function test_aLosingOrRefundedCopyTradePaysNothingMore() public {
        MimirPool p = _feePool();
        vm.prank(alice);
        uint256 id = p.createMarket{value: 10 * ONE}("q", "Y", "N", "u", "c", DEADLINE, A, address(0));
        vm.prank(carol);
        p.stake{value: 10 * ONE}(id, B, ref);
        vm.warp(AFTER);
        vm.prank(oracle);
        p.resolve(id, A, "v", bytes32(0));
        p.claimFor(id, alice);
        assert(p.accruedFees(ref) == 0); // carol (the copier) lost
    }

    function test_theFirstReferrerSticksAndNobodyPaysThemselves() public {
        MimirPool p = _feePool();
        vm.prank(alice);
        uint256 id = p.createMarket{value: 10 * ONE}("q", "Y", "N", "u", "c", DEADLINE, A, alice);
        vm.prank(alice);
        p.stake{value: 2 * ONE}(id, A, ref); // a later referrer does not replace the first
        assert(p.referrerOf(id, alice) == alice);
        vm.prank(carol);
        p.stake{value: 10 * ONE}(id, B, address(0));
        vm.warp(AFTER);
        vm.prank(oracle);
        p.resolve(id, A, "v", bytes32(0));
        (, uint256 fee) = p.claimable(id, alice);
        assert(fee == 0);
    }

    function test_aNewFeeRecipientIsTimelocked() public {
        pool.queueFeeRecipient(carol);
        (bool early,) = address(pool).call(abi.encodeWithSelector(MimirPool.executeFeeRecipient.selector));
        assert(!early);
        vm.warp(T0 + pool.TIMELOCK_SECONDS());
        pool.executeFeeRecipient();
        assert(pool.feeRecipient() == carol);
    }

    /// Any stakes, with or without a referrer: a winner gets at least their net
    /// stake, and the market never pays out more than it took in.
    function testFuzz_winnersKeepTheirStakeAndThePotHolds(uint96 rawA1, uint96 rawA2, uint96 rawB, bool aWins, bool copy)
        public
    {
        uint256 a1 = 2 * ONE + (uint256(rawA1) % (1_000 * ONE));
        uint256 a2 = 2 * ONE + (uint256(rawA2) % (1_000 * ONE));
        uint256 b = 2 * ONE + (uint256(rawB) % (1_000 * ONE));
        MimirPool p = _feePool();
        address r = copy ? ref : address(0);
        vm.deal(alice, a1);
        vm.deal(carol, a2);
        vm.deal(keeper, b);

        vm.prank(alice);
        uint256 id = p.createMarket{value: a1}("q", "Y", "N", "u", "c", DEADLINE, A, r);
        vm.prank(carol);
        p.stake{value: a2}(id, A, r);
        vm.prank(keeper);
        p.stake{value: b}(id, B, r);

        vm.warp(AFTER);
        vm.prank(oracle);
        p.resolve(id, aWins ? A : B, "v", bytes32(0));

        if (aWins) {
            p.claimFor(id, alice);
            p.claimFor(id, carol);
            assert(alice.balance >= _net(a1) && carol.balance >= _net(a2) && keeper.balance == 0);
        } else {
            p.claimFor(id, keeper);
            assert(keeper.balance >= _net(b) && alice.balance == 0 && carol.balance == 0);
        }
        uint256 paid = alice.balance + carol.balance + keeper.balance;
        uint256 fees = p.accruedFees(platform) + p.accruedFees(ref);
        assert(paid + fees <= a1 + a2 + b);
        assert(address(p).balance == a1 + a2 + b - paid);
        assert(address(p).balance >= fees);
    }

    // ── Staking rules, pause, parking, admin ────────────────────────────────

    function test_stakingClosesBeforeTheDeadline() public {
        uint256 id = _create(alice, 10 * ONE, A);
        vm.warp(DEADLINE - pool.LOCK_SECONDS() + 1);
        vm.prank(carol);
        (bool ok, bytes memory r) =
            address(pool).call{value: 2 * ONE}(abi.encodeWithSelector(MimirPool.stake.selector, id, B, address(0)));
        assert(!ok && keccak256(r) == _err(MimirPool.BettingClosed.selector));
    }

    function test_stakesBelowTheMinimumOrOnNoSideAreRefused() public {
        uint256 id = _create(alice, 10 * ONE, A);
        vm.prank(carol);
        (bool small,) = address(pool).call{value: ONE}(abi.encodeWithSelector(MimirPool.stake.selector, id, B, address(0)));
        vm.prank(carol);
        (bool noSide,) =
            address(pool).call{value: 2 * ONE}(abi.encodeWithSelector(MimirPool.stake.selector, id, 3, address(0)));
        assert(!small && !noSide);
    }

    // Since the 2026-10-08 hardening, pause also stops settlement and winners' payouts; refunds still go out
    // (MainnetHardening.t.sol). Unpausing lets the decided market pay as before.
    function test_pauseStopsStakesAndSettlementUntilUnpaused() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        pool.setPaused(true);

        vm.prank(carol);
        (bool staked,) =
            address(pool).call{value: 2 * ONE}(abi.encodeWithSelector(MimirPool.stake.selector, id, B, address(0)));
        assert(!staked);

        vm.warp(AFTER);
        vm.prank(oracle);
        (bool proposed,) = address(pool).call(abi.encodeWithSelector(MimirPool.resolve.selector, id, B, "x", bytes32(0)));
        assert(!proposed);

        pool.setPaused(false);
        _settle(id, B);
        pool.claimFor(id, carol);
        assert(carol.balance > 90 * ONE);
    }

    function test_aRefusedPushIsParkedAndPulledLater() public {
        uint256 id = _createAs(maker, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        _settle(id, A);

        maker.setRefuse(true);
        pool.claimFor(id, address(maker));
        uint256 parked = pool.pendingWithdrawals(address(maker));
        assert(parked == 20 * ONE);

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
