// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3, IMimirFees} from "../MimirV3.sol";
import {FlatFees} from "./FlatFees.sol";

/**
 * One test (or more) per finding of the 2026-10-06 review (docs/ARC.md) that
 * still applies after the fee rework (ERC-20 mode, permit and the agent
 * allowlist are gone). Entry fees are 0 here (FlatFees(0)) so amounts isolate
 * the mechanics. Dependency-free like the rest of the suite.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

/// A challenger that disputes, then tries to settle the claim a second time
/// from its receive() while the arbiter's ruling is paying it.
contract ReentrantDisputer {
    MimirV3 immutable m;
    uint256 public id;

    struct Seen {
        bool armed;
        bool called;
        uint8 state;
        bool reentered;
        bool stoppedByLock;
    }
    Seen public seen;

    constructor(MimirV3 _m) {
        m = _m;
        seen.armed = true;
    }

    function challenge(uint256 _id, uint256 stake) external payable {
        id = _id;
        m.challengeClaim{value: stake}(_id, stake, "", address(0));
    }

    function dispute(uint256 bond) external payable {
        m.disputeResolution{value: bond}(id);
    }

    receive() external payable {
        Seen memory s = seen;
        if (!s.armed) return;
        s.armed = false;
        s.called = true;
        (,,,,,,,,, s.state,,,,,,,,) = m.getClaim(id);
        (bool ok, bytes memory ret) = address(m).call(abi.encodeWithSelector(MimirV3.refundExpired.selector, id));
        s.reentered = ok;
        s.stoppedByLock = keccak256(ret) == keccak256(abi.encodeWithSelector(MimirV3.Reentrant.selector));
        seen = s;
    }
}

contract MimirV3ReviewTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3 mimir;
    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address creator = address(0xC7ea704);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant ONE = 1e18;
    uint256 constant STAKE = 10 * ONE;
    uint256 constant GAP = 1 days;
    uint256 constant WINDOW = 1 days;

    function setUp() public {
        vm.warp(1_000_000);
        mimir = new MimirV3(oracle, platform, IMimirFees(address(new FlatFees(0))), WINDOW, 2e18);
        vm.deal(creator, 1_000 * ONE);
        vm.deal(alice, 1_000 * ONE);
        vm.deal(bob, 1_000 * ONE);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _create(address who) internal returns (uint256 id) {
        vm.prank(who);
        id = mimir.createClaim{value: STAKE}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, STAKE,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", address(0)
        );
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,,,,,,,, state,,,,,,,,) = mimir.getClaim(id);
    }

    function _lockError() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(MimirV3.Reentrant.selector);
    }

    // ── #3 + #6: settle before paying the bond; reentrancy lock ────────────

    function test_aDisputerCannotSettleTwiceFromItsReceive() public {
        ReentrantDisputer d = new ReentrantDisputer(mimir);
        vm.deal(address(d), 100 * ONE);
        uint256 id = _create(creator);
        d.challenge{value: STAKE}(id, STAKE);

        vm.warp(block.timestamp + GAP + 1);
        uint8 creatorSide = mimir.SIDE_CREATOR();
        vm.prank(oracle);
        mimir.resolveClaim(id, creatorSide, "proposed", 90, bytes32(uint256(7)));
        uint256 bond = mimir.MIN_STAKE();
        d.dispute{value: bond}(bond);

        // Late in the dispute, the arbiter rules for the disputer: it is paid
        // its winnings and its bond, and tries to re-enter refundExpired.
        // (After the grace the ruling itself is refused: finding #2.)
        vm.warp(block.timestamp + mimir.RESOLUTION_GRACE_SECONDS() - 1);
        mimir.resolveDispute(id, mimir.SIDE_CHALLENGERS(), "arbiter", 100, bytes32(uint256(8)));

        (, bool called, uint8 seenState, bool reentered, bool stoppedByLock) = d.seen();
        assert(called);
        // Every transfer happens after the claim is settled...
        assert(seenState == mimir.ST_RESOLVED());
        // ...and the second settlement is refused by the lock itself.
        assert(!reentered);
        assert(stoppedByLock);

        assert(mimir.totalResolved() == 1);
        assert(_state(id) == mimir.ST_RESOLVED());
        // Nothing left in the escrow but what it still owes.
        assert(
            address(mimir).balance
                == mimir.lifetimeFeesAccrued() - mimir.lifetimeFeesClaimed() + mimir.pendingWithdrawals(address(d))
        );
    }

    // ── #2: no verdict once the refund is open ──────────────────────────────

    function test_aLateVerdictIsRefusedOnceTheRefundIsOpen() public {
        uint256 id = _create(creator);
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "", address(0));

        vm.warp(block.timestamp + GAP + mimir.RESOLUTION_GRACE_SECONDS());
        bytes memory verdict = abi.encodeWithSelector(
            MimirV3.resolveClaim.selector, id, mimir.SIDE_CREATOR(), "late", uint8(90), bytes32(uint256(1))
        );
        vm.prank(oracle);
        (bool ok, bytes memory ret) = address(mimir).call(verdict);
        assert(!ok);
        assert(keccak256(ret) == keccak256(abi.encodeWithSelector(MimirV3.GraceOver.selector)));

        // Whoever comes first, the refund is the only outcome.
        mimir.refundExpired(id);
        (,,,,,,,,,, uint8 side,,,,,,,) = mimir.getClaim(id);
        assert(side == mimir.SIDE_UNRESOLVABLE());
    }

    function test_aVerdictJustBeforeTheGraceStillLands() public {
        uint256 id = _create(creator);
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "", address(0));

        vm.warp(block.timestamp + GAP + mimir.RESOLUTION_GRACE_SECONDS() - 1);
        uint8 side = mimir.SIDE_CREATOR();
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "on time", 90, bytes32(uint256(1)));
        assert(_state(id) == mimir.ST_PROPOSED());
    }

    function test_aLateArbiterRulingIsRefusedOnceTheRefundIsOpen() public {
        uint256 id = _create(creator);
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "", address(0));
        vm.warp(block.timestamp + GAP + 1);
        uint8 creatorSide = mimir.SIDE_CREATOR();
        vm.prank(oracle);
        mimir.resolveClaim(id, creatorSide, "proposed", 90, bytes32(uint256(7)));
        uint256 bond = mimir.MIN_STAKE();
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(id);

        vm.warp(block.timestamp + mimir.RESOLUTION_GRACE_SECONDS());
        (bool ok, bytes memory ret) = address(mimir).call(abi.encodeWithSelector(
            MimirV3.resolveDispute.selector, id, mimir.SIDE_CHALLENGERS(), "late", uint8(100), bytes32(0)
        ));
        assert(!ok);
        assert(keccak256(ret) == keccak256(abi.encodeWithSelector(MimirV3.GraceOver.selector)));

        mimir.refundExpired(id);
        assert(_state(id) == mimir.ST_RESOLVED());
        assert(mimir.totalResolved() == 1);
    }

    // -- #4: timelocked ownership; an unruled dispute costs the bond -------

    function test_ownershipCannotBeAcceptedBeforeTheTimelock() public {
        mimir.transferOwnership(alice);
        assert(mimir.pendingOwnerEta() == block.timestamp + mimir.OWNERSHIP_TIMELOCK_SECONDS());

        vm.warp(block.timestamp + mimir.OWNERSHIP_TIMELOCK_SECONDS() - 1);
        vm.prank(alice);
        (bool early,) = address(mimir).call(abi.encodeWithSelector(MimirV3.acceptOwnership.selector));
        assert(!early);
        assert(mimir.owner() == address(this));

        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        mimir.acceptOwnership();
        assert(mimir.owner() == alice);
        assert(mimir.pendingOwnerEta() == 0);
    }

    function test_aQueuedOwnershipTransferCanBeCancelled() public {
        mimir.transferOwnership(alice);

        vm.prank(bob);
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(MimirV3.cancelOwnershipTransfer.selector));
        assert(!stranger);

        mimir.cancelOwnershipTransfer();
        assert(mimir.pendingOwner() == address(0));
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(MimirV3.acceptOwnership.selector));
        assert(!ok);
        assert(mimir.owner() == address(this));
    }

    function test_stallingALossWithAnUnruledDisputeCostsTheBond() public {
        uint256 id = _create(creator);
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "", address(0));
        vm.warp(block.timestamp + GAP + 1);
        uint8 creatorSide = mimir.SIDE_CREATOR();
        vm.prank(oracle);
        mimir.resolveClaim(id, creatorSide, "creator wins", 90, bytes32(uint256(7)));

        // Alice lost. She disputes and the arbiter never rules.
        uint256 bond = mimir.MIN_STAKE();
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(id);
        vm.warp(block.timestamp + mimir.RESOLUTION_GRACE_SECONDS());
        mimir.refundExpired(id);

        // Stake back, bond gone to the platform: stalling is not free.
        assert(alice.balance == aliceBefore - bond + STAKE);
        assert(mimir.accruedFees(platform) == bond);
        assert(address(mimir).balance == mimir.lifetimeFeesAccrued() - mimir.lifetimeFeesClaimed());
    }

    // -- #1 (reworked): the referrer is free-form; a rematch keeps it only for its creator

    function test_anyReferrerIsAcceptedAndRecorded() public {
        address ref = address(0xA6E7);
        vm.prank(creator);
        uint256 id = mimir.createClaim{value: STAKE}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, STAKE,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", ref
        );
        (, address recorded) = mimir.getClaimFees(id);
        assert(recorded == ref);

        // The creator's rematch inherits it; a stranger's does not.
        vm.prank(creator);
        uint256 own = mimir.createRematch{value: STAKE}(id, block.timestamp + GAP, STAKE, "");
        vm.prank(alice);
        uint256 strangers = mimir.createRematch{value: STAKE}(id, block.timestamp + GAP, STAKE, "");
        (, address ownRef) = mimir.getClaimFees(own);
        (, address strangerRef) = mimir.getClaimFees(strangers);
        assert(ownRef == ref);
        assert(strangerRef == address(0));
    }

    // -- #8 (reworked): the fees contract must have code -------------------

    function deployWithFees(address fees) external returns (MimirV3) {
        return new MimirV3(oracle, platform, IMimirFees(fees), 0, 2e18);
    }

    function test_aFeesAddressWithoutCodeIsRefusedAtDeploy() public {
        (bool ok, bytes memory ret) =
            address(this).call(abi.encodeWithSelector(this.deployWithFees.selector, address(0xDEAD)));
        assert(!ok);
        assert(keccak256(ret) == keccak256(abi.encodeWithSignature("Error(string)", "Mimir: fees has no code")));
    }

    // -- Pool cap: challengers at most MAX_POOL_MULTIPLE x the creator ------

    function _stakeAs(address who, uint256 id, uint256 stake) internal returns (bool ok, bytes memory ret) {
        vm.deal(who, stake);
        vm.prank(who);
        (ok, ret) = address(mimir).call{value: stake}(
            abi.encodeWithSelector(MimirV3.challengeClaim.selector, id, stake, "", address(0))
        );
    }

    function _isPoolFull(bytes memory ret) internal pure returns (bool) {
        return keccak256(ret) == keccak256(abi.encodeWithSelector(MimirV3.PoolFull.selector));
    }

    function test_thePoolTakesExactlyFiveTimesTheCreator() public {
        uint256 id = _create(creator); // 10
        (bool a,) = _stakeAs(alice, id, 30 * ONE);
        (bool b,) = _stakeAs(bob, id, 20 * ONE); // 50 = 5x
        assert(a && b);
        (,,,,,, uint256 total,,,,,,,,,,,) = mimir.getClaim(id);
        assert(total == 5 * STAKE);

        // One more minimum stake would push it past 5x.
        (bool c, bytes memory ret) = _stakeAs(address(0xCA201), id, mimir.MIN_STAKE());
        assert(!c);
        assert(_isPoolFull(ret));
    }

    function test_aSingleChallengePastFiveTimesIsRefused() public {
        uint256 id = _create(creator);
        (bool ok, bytes memory ret) = _stakeAs(alice, id, 5 * STAKE + 1);
        assert(!ok);
        assert(_isPoolFull(ret));
        (bool exact,) = _stakeAs(alice, id, 5 * STAKE);
        assert(exact);
    }

    function test_aRematchInheritsThePoolCap() public {
        uint256 parent = _create(creator);
        vm.prank(creator);
        uint256 id = mimir.createRematch{value: STAKE}(parent, block.timestamp + GAP, STAKE, "");
        (bool ok, bytes memory ret) = _stakeAs(alice, id, 5 * STAKE + 1);
        assert(!ok);
        assert(_isPoolFull(ret));
    }

    function test_fixedOddsIsNotPoolCapped() public {
        // 1x fixed odds: no profit to reserve, so only the cap could refuse a big stake.
        vm.prank(creator);
        uint256 id = mimir.createClaim{value: STAKE}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, STAKE,
            "custom", 0, "binary", "fixed", 10_000, "", "rule", 0, false, "", address(0)
        );
        (bool ok,) = _stakeAs(alice, id, 10 * STAKE);
        assert(ok);
    }
}
