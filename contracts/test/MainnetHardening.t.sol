// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3, IMimirFees} from "../MimirV3.sol";
import {MimirPool, IMimirFees as IPoolFees} from "../MimirPool.sol";
import {MimirFees} from "../MimirFees.sol";
import {FlatFees} from "./FlatFees.sol";

/**
 * Mainnet hardening (security review, 2026-10-08): separated roles (owner, arbiter, oracle, fee recipient), an
 * instant oracle revoke, a pause that also stops settlement while refunds still let funds out, an owner veto on a
 * proposal, a dispute-window floor off testnet, stake caps and an optional early lock. Entry fees are 0 (FlatFees)
 * so the amounts isolate the mechanics.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function chainId(uint256) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
}

contract MimirV3HardeningTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3 mimir;
    address owner = address(0x5AFE);
    address arbiter = address(0xA2B1);
    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address creator = address(0xC7ea704);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant ONE = 1e18;
    uint256 constant STAKE = 10 * ONE;
    uint256 constant GAP = 1 days;
    uint256 constant WINDOW = 1 days;
    uint256 constant GRACE = 7 days;

    function setUp() public {
        vm.warp(1_000_000);
        mimir = _deploy(owner, arbiter, oracle, platform, WINDOW);
        vm.deal(creator, 1_000 * ONE);
        vm.deal(alice, 1_000 * ONE);
        vm.deal(bob, 1_000 * ONE);
    }

    function _deploy(address o, address a, address orc, address fee, uint256 window) internal returns (MimirV3) {
        return new MimirV3(o, a, orc, fee, IMimirFees(address(new FlatFees(0))), window, 2e18);
    }

    function _tryDeploy(address o, address a, address orc, address fee, uint256 window) internal returns (bool ok) {
        IMimirFees f = IMimirFees(address(new FlatFees(0)));
        try new MimirV3(o, a, orc, fee, f, window, 2e18) {
            ok = true;
        } catch {
            ok = false;
        }
    }

    function _create(uint256 stake) internal returns (uint256 id) {
        vm.prank(creator);
        id = mimir.createClaim{value: stake}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, stake,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", address(0)
        );
    }

    function _challenge(address who, uint256 id, uint256 stake) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(mimir).call{value: stake}(
            abi.encodeWithSelector(MimirV3.challengeClaim.selector, id, stake, "", address(0))
        );
    }

    function _claim() internal returns (uint256 id) {
        id = _create(STAKE);
        assert(_challenge(alice, id, STAKE));
    }

    function _propose(uint256 id, uint8 side) internal {
        vm.warp(block.timestamp + GAP + 1);
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "proposed", 90, bytes32(uint256(7)));
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,,,,,,,, state,,,,,,,,) = mimir.getClaim(id);
    }

    function _winner(uint256 id) internal view returns (uint8 side) {
        (,,,,,,,,,, side,,,,,,,) = mimir.getClaim(id);
    }

    // ── Roles ────────────────────────────────────────────────────────────────

    function test_rolesAreSetAtDeployNotTakenFromTheDeployer() public view {
        assert(mimir.owner() == owner);
        assert(mimir.arbiter() == arbiter);
        assert(mimir.oracle() == oracle);
        assert(mimir.feeRecipient() == platform);
        assert(mimir.owner() != address(this));
    }

    function test_theOracleKeyCannotAlsoHoldAdminOrMoneyRoles() public {
        assert(!_tryDeploy(oracle, arbiter, oracle, platform, WINDOW));
        assert(!_tryDeploy(owner, oracle, oracle, platform, WINDOW));
        assert(!_tryDeploy(owner, arbiter, oracle, oracle, WINDOW));
        assert(!_tryDeploy(address(0), arbiter, oracle, platform, WINDOW));
        assert(!_tryDeploy(owner, address(0), oracle, platform, WINDOW));
        assert(_tryDeploy(owner, owner, oracle, platform, WINDOW)); // one Safe as owner and arbiter is allowed
    }

    function test_onlyTheArbiterRulesADispute() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        uint256 bond = mimir.DISPUTE_BOND();
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(id);

        vm.prank(owner);
        (bool byOwner,) = address(mimir).call(
            abi.encodeWithSelector(MimirV3.resolveDispute.selector, id, uint8(2), "x", uint8(90), bytes32(0))
        );
        assert(!byOwner);

        uint8 side = mimir.SIDE_CHALLENGERS();
        vm.prank(arbiter);
        mimir.resolveDispute(id, side, "arbiter", 90, bytes32(0));
        assert(_state(id) == mimir.ST_RESOLVED());
    }

    function test_theOwnerSetsTheArbiterButNeverToTheOracle() public {
        vm.prank(owner);
        (bool toOracle,) = address(mimir).call(abi.encodeWithSelector(MimirV3.setArbiter.selector, oracle));
        assert(!toOracle);
        vm.prank(bob);
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(MimirV3.setArbiter.selector, bob));
        assert(!stranger);
        vm.prank(owner);
        mimir.setArbiter(bob);
        assert(mimir.arbiter() == bob);
    }

    // ── Emergency oracle revoke ──────────────────────────────────────────────

    function test_revokingTheOracleIsInstantAndAppointingStaysTimelocked() public {
        uint256 id = _claim();
        vm.prank(owner);
        mimir.revokeOracle();
        assert(mimir.oracle() == address(0));

        vm.warp(block.timestamp + GAP + 1);
        vm.prank(oracle);
        (bool resolved,) = address(mimir).call(
            abi.encodeWithSelector(MimirV3.resolveClaim.selector, id, uint8(1), "x", uint8(90), bytes32(0))
        );
        assert(!resolved);

        address next = address(0x0E27);
        vm.prank(owner);
        mimir.queueOracle(next);
        (bool early,) = address(mimir).call(abi.encodeWithSelector(MimirV3.executeOracle.selector));
        assert(!early);
        vm.warp(block.timestamp + 2 days);
        mimir.executeOracle();
        assert(mimir.oracle() == next);
    }

    function test_onlyTheOwnerRevokesTheOracle() public {
        vm.prank(bob);
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(MimirV3.revokeOracle.selector));
        assert(!ok);
    }

    // ── Pause ────────────────────────────────────────────────────────────────

    function test_pauseStopsProposingFinalizingAndRuling() public {
        uint256 a = _claim();
        uint256 b = _claim();
        _propose(a, mimir.SIDE_CREATOR());
        uint256 bond = mimir.DISPUTE_BOND();
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(a);

        vm.prank(owner);
        mimir.setPaused(true);

        vm.prank(oracle);
        (bool proposed,) = address(mimir).call(
            abi.encodeWithSelector(MimirV3.resolveClaim.selector, b, uint8(1), "x", uint8(90), bytes32(0))
        );
        vm.prank(arbiter);
        (bool ruled,) = address(mimir).call(
            abi.encodeWithSelector(MimirV3.resolveDispute.selector, a, uint8(1), "x", uint8(90), bytes32(0))
        );
        assert(!proposed && !ruled);
    }

    function test_pauseStopsAnUndisputedProposalFromPayingOut() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        vm.prank(owner);
        mimir.setPaused(true);
        vm.warp(block.timestamp + WINDOW);
        (bool finalized,) = address(mimir).call(abi.encodeWithSelector(MimirV3.finalizeResolution.selector, id));
        assert(!finalized);
        assert(_state(id) == mimir.ST_PROPOSED());
    }

    function test_whilePausedFundsStillLeaveByRefund() public {
        uint256 active = _claim();
        uint256 open = _create(STAKE);
        vm.prank(owner);
        mimir.setPaused(true);

        // A claim nobody challenged: the creator cancels as usual.
        uint256 before = creator.balance;
        vm.prank(creator);
        mimir.cancelClaim(open);
        assert(creator.balance == before + STAKE);

        // A challenged claim: after the grace anyone refunds every stake.
        vm.warp(block.timestamp + GAP + GRACE);
        uint256 aliceBefore = alice.balance;
        uint256 creatorBefore = creator.balance;
        mimir.refundExpired(active);
        assert(alice.balance == aliceBefore + STAKE);
        assert(creator.balance == creatorBefore + STAKE);
        assert(_winner(active) == mimir.SIDE_UNRESOLVABLE());
    }

    function test_whilePausedAnUnruledDisputeRefundsAndReturnsTheBond() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        uint256 bond = mimir.DISPUTE_BOND();
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(id);
        vm.prank(owner);
        mimir.setPaused(true);

        vm.warp(block.timestamp + GRACE);
        uint256 aliceBefore = alice.balance;
        mimir.refundExpired(id);
        // The proposal is not honoured during an emergency: stake and bond come back.
        assert(_winner(id) == mimir.SIDE_UNRESOLVABLE());
        assert(alice.balance == aliceBefore + STAKE + bond);
    }

    // ── Owner veto ───────────────────────────────────────────────────────────

    function test_theOwnerCanVetoAProposalToTheArbiter() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        vm.prank(bob);
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(MimirV3.vetoProposal.selector, id));
        assert(!stranger);

        vm.prank(owner);
        mimir.vetoProposal(id);
        assert(_state(id) == mimir.ST_DISPUTED());

        uint8 side = mimir.SIDE_CHALLENGERS();
        vm.prank(arbiter);
        mimir.resolveDispute(id, side, "vetoed", 90, bytes32(0));
        assert(_winner(id) == mimir.SIDE_CHALLENGERS());
    }

    function test_aVetoTheArbiterNeverRuledOnEndsInARefund() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        vm.prank(owner);
        mimir.vetoProposal(id);
        vm.warp(block.timestamp + GRACE);
        uint256 aliceBefore = alice.balance;
        mimir.refundExpired(id);
        assert(_winner(id) == mimir.SIDE_UNRESOLVABLE());
        assert(alice.balance == aliceBefore + STAKE);
    }

    function test_aVetoMustComeInsideTheDisputeWindow() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        vm.warp(block.timestamp + WINDOW);
        vm.prank(owner);
        (bool late,) = address(mimir).call(abi.encodeWithSelector(MimirV3.vetoProposal.selector, id));
        assert(!late);
    }

    // ── Dispute window floor ─────────────────────────────────────────────────

    function test_offTestnetTheDisputeWindowIsAtLeastADay() public {
        vm.chainId(5042);
        assert(!_tryDeploy(owner, arbiter, oracle, platform, 1 hours));
        assert(!_tryDeploy(owner, arbiter, oracle, platform, 0));
        assert(_tryDeploy(owner, arbiter, oracle, platform, 1 days));
        vm.chainId(5042002);
        assert(_tryDeploy(owner, arbiter, oracle, platform, 1 hours));
    }

    // ── Stake caps ───────────────────────────────────────────────────────────

    function test_capsLimitAnAccountAndAMarket() public {
        vm.prank(bob);
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(MimirV3.setCaps.selector, 1, 1));
        assert(!stranger);

        vm.prank(owner);
        mimir.setCaps(25 * ONE, 12 * ONE);

        vm.prank(creator);
        (bool tooBig,) = address(mimir).call{value: 13 * ONE}(
            abi.encodeWithSelector(
                MimirV3.createClaim.selector, "q", "y", "n", "u", block.timestamp + GAP, 13 * ONE,
                "c", 0, "binary", "pool", 0, "", "r", 0, false, "", address(0)
            )
        );
        assert(!tooBig);

        uint256 id = _create(STAKE); // 10
        assert(!_challenge(alice, id, 13 * ONE)); // over the account cap
        assert(_challenge(alice, id, 12 * ONE)); // 22 in the market
        assert(!_challenge(bob, id, 4 * ONE)); // 26 would pass the market cap
        assert(_challenge(bob, id, 3 * ONE)); // 25 exactly

        vm.prank(owner);
        mimir.setCaps(0, 0); // 0 lifts them
        assert(_create(50 * ONE) > id);
    }

    // ── Early lock ───────────────────────────────────────────────────────────

    function test_aMarketCanLockBeforeItsDeadline() public {
        uint256 id = _create(STAKE);
        uint256 kickoff = block.timestamp + 6 hours;
        vm.prank(bob);
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(MimirV3.setLockAt.selector, id, kickoff));
        assert(!stranger);
        vm.prank(creator);
        (bool afterDeadline,) =
            address(mimir).call(abi.encodeWithSelector(MimirV3.setLockAt.selector, id, block.timestamp + GAP));
        assert(!afterDeadline);

        vm.prank(creator);
        mimir.setLockAt(id, kickoff);
        assert(mimir.lockAt(id) == kickoff);

        // Only ever earlier, never later.
        vm.prank(owner);
        (bool later,) = address(mimir).call(abi.encodeWithSelector(MimirV3.setLockAt.selector, id, kickoff + 1));
        assert(!later);

        vm.warp(kickoff - 1);
        assert(_challenge(alice, id, STAKE));
        vm.warp(kickoff);
        assert(!_challenge(bob, id, STAKE));
    }
}

contract MimirPoolHardeningTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirPool pool;
    address owner = address(0x5AFE);
    address arbiter = address(0xA2B1);
    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address alice = address(0xA11CE);
    address carol = address(0xCA201);

    uint256 constant ONE = 1e18;
    uint256 constant WINDOW = 1 hours;
    uint256 constant T0 = 1_000_000;
    uint256 constant DEADLINE = T0 + 1 days;
    uint256 constant GRACE = 7 days;
    uint8 constant A = 1;
    uint8 constant B = 2;
    uint8 constant UNRESOLVABLE = 4;

    function setUp() public {
        vm.warp(T0);
        pool = new MimirPool(owner, arbiter, oracle, platform, IPoolFees(address(new FlatFees(0))), WINDOW, 2e18);
        vm.deal(alice, 1_000 * ONE);
        vm.deal(carol, 1_000 * ONE);
    }

    function _create(address who, uint256 amount, uint8 side) internal returns (uint256 id) {
        vm.prank(who);
        id = pool.createMarket{value: amount}("Will it?", "Yes", "No", "https://example.com", "custom", DEADLINE, side, address(0));
    }

    function _stake(address who, uint256 id, uint256 amount, uint8 side) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(pool).call{value: amount}(abi.encodeWithSelector(MimirPool.stake.selector, id, side, address(0)));
    }

    function _propose(uint256 id, uint8 outcome) internal {
        vm.warp(DEADLINE + 1);
        vm.prank(oracle);
        pool.resolve(id, outcome, "proposed", bytes32(uint256(1)));
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,, state,,,) = pool.getMarket(id);
    }

    function _outcome(uint256 id) internal view returns (uint8 outcome) {
        (,,,, outcome,,) = pool.getMarket(id);
    }

    function test_poolRolesAreSeparateAndOnlyTheArbiterRules() public {
        assert(pool.owner() == owner && pool.arbiter() == arbiter && pool.oracle() == oracle);
        IPoolFees f = IPoolFees(address(new FlatFees(0)));
        try new MimirPool(owner, arbiter, owner, platform, f, WINDOW, 2e18) {
            assert(false);
        } catch {}

        uint256 id = _create(alice, 10 * ONE, A);
        assert(_stake(carol, id, 10 * ONE, B));
        _propose(id, A);
        uint256 bond = pool.DISPUTE_BOND();
        vm.prank(carol);
        pool.dispute{value: bond}(id);
        vm.prank(owner);
        (bool byOwner,) = address(pool).call(abi.encodeWithSelector(MimirPool.resolveDispute.selector, id, B, "x", bytes32(0)));
        assert(!byOwner);
        vm.prank(arbiter);
        pool.resolveDispute(id, B, "arbiter", bytes32(0));
        assert(_outcome(id) == B);
    }

    function test_poolOracleRevokeIsInstant() public {
        uint256 id = _create(alice, 10 * ONE, A);
        vm.prank(owner);
        pool.revokeOracle();
        vm.warp(DEADLINE + 1);
        vm.prank(oracle);
        (bool ok,) = address(pool).call(abi.encodeWithSelector(MimirPool.resolve.selector, id, A, "x", bytes32(0)));
        assert(!ok);
    }

    function test_poolPauseStopsSettlementAndWinnerPayoutsButNotRefunds() public {
        uint256 won = _create(alice, 10 * ONE, A);
        assert(_stake(carol, won, 10 * ONE, B));
        uint256 stuck = _create(alice, 10 * ONE, A);
        assert(_stake(carol, stuck, 10 * ONE, B));
        _propose(won, A);
        vm.warp(block.timestamp + WINDOW);
        pool.finalize(won); // resolved before the pause

        vm.prank(owner);
        pool.setPaused(true);

        // A decided winner is not paid during an emergency.
        (bool paid,) = address(pool).call(abi.encodeWithSelector(MimirPool.claimFor.selector, won, alice));
        assert(!paid);

        // An unresolved market refunds after the grace, and the refund is paid while paused.
        vm.warp(DEADLINE + GRACE);
        pool.refundExpired(stuck);
        uint256 before = carol.balance;
        pool.claimFor(stuck, carol);
        assert(carol.balance == before + 10 * ONE);
    }

    function test_poolPausedDisputeRefundsAndVetoGoesToTheArbiter() public {
        uint256 id = _create(alice, 10 * ONE, A);
        assert(_stake(carol, id, 10 * ONE, B));
        _propose(id, A);
        vm.prank(owner);
        pool.vetoProposal(id);
        assert(_state(id) == pool.ST_DISPUTED());

        vm.prank(owner);
        pool.setPaused(true);
        vm.warp(block.timestamp + GRACE);
        pool.refundExpired(id);
        assert(_outcome(id) == UNRESOLVABLE);
    }

    function test_poolCapsCountAnAccountsStakesTogether() public {
        vm.prank(owner);
        pool.setCaps(30 * ONE, 12 * ONE);
        uint256 id = _create(alice, 10 * ONE, A);
        assert(!_stake(alice, id, 3 * ONE, B)); // 13 across both sides
        assert(_stake(alice, id, 2 * ONE, B));
        assert(_stake(carol, id, 12 * ONE, B)); // 24 in the market
        vm.deal(address(0xD0), 100 * ONE);
        assert(!_stake(address(0xD0), id, 7 * ONE, A)); // 31
        assert(_stake(address(0xD0), id, 6 * ONE, A)); // 30
    }

    function test_poolEarlyLock() public {
        uint256 id = _create(alice, 10 * ONE, A);
        uint256 kickoff = T0 + 6 hours;
        vm.prank(alice);
        pool.setLockAt(id, kickoff);
        vm.warp(kickoff);
        assert(!_stake(carol, id, 5 * ONE, B));
    }
}

contract MimirFeesHardeningTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 constant OLD_KEY = 0xA11;
    uint256 constant NEW_KEY = 0xB22;
    uint256 constant T0 = 1_000_000;
    address owner = address(0x5AFE);
    address user = address(0xA11CE);
    MimirFees fees;

    function setUp() public {
        vm.warp(T0);
        fees = new MimirFees(owner, vm.addr(OLD_KEY));
    }

    function _apply(uint256 key, uint8 tier) internal returns (bool ok) {
        uint64 expires = uint64(block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, fees.ticketDigest(user, tier, expires));
        vm.prank(user);
        (ok,) = address(fees).call(abi.encodeWithSelector(MimirFees.applyTicket.selector, tier, expires, abi.encodePacked(r, s, v)));
    }

    function test_theOwnerIsSetAtDeploy() public view {
        assert(fees.owner() == owner);
    }

    function test_revokingTheSignerIsInstantAndRetiresItsTickets() public {
        assert(_apply(OLD_KEY, 2));
        assert(fees.entryBps(user) == fees.WHALE_BPS());
        vm.prank(owner);
        fees.revokeSigner();
        assert(fees.entryBps(user) == fees.BASE_BPS());
        assert(!_apply(OLD_KEY, 2));
    }

    function test_aNewSignerIsTimelocked() public {
        vm.prank(owner);
        fees.queueSigner(vm.addr(NEW_KEY));
        (bool early,) = address(fees).call(abi.encodeWithSelector(MimirFees.executeSigner.selector));
        assert(!early);
        vm.warp(T0 + 2 days);
        fees.executeSigner();
        assert(fees.signer() == vm.addr(NEW_KEY));
        assert(_apply(NEW_KEY, 1));
    }
}
