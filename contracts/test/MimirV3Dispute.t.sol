// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3, IMimirFees} from "../MimirV3.sol";
import {FlatFees} from "./FlatFees.sol";

/**
 * Optimistic resolution with a dispute window. Entry fees are 0 here
 * (FlatFees(0)) so the amounts isolate the dispute mechanics.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

contract MimirV3DisputeTest {
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
        mimir = new MimirV3(address(this), address(this), oracle, platform, IMimirFees(address(new FlatFees(0))), WINDOW, 2e18);
        vm.deal(creator, 1_000 * ONE);
        vm.deal(alice, 1_000 * ONE);
        vm.deal(bob, 1_000 * ONE);
    }

    function _claim() internal returns (uint256 id) {
        vm.prank(creator);
        id = mimir.createClaim{value: STAKE}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, STAKE,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", address(0)
        );
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "", address(0));
    }

    function _propose(uint256 id, uint8 side) internal {
        vm.warp(block.timestamp + GAP + 1);
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "proposed", 90, bytes32(uint256(7)));
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,,,,,,,, state,,,,,,,,) = mimir.getClaim(id);
    }

    function test_aProposalPaysNothingUntilTheWindowCloses() public {
        uint256 id = _claim();
        uint256 before = creator.balance;
        _propose(id, mimir.SIDE_CREATOR());
        assert(_state(id) == mimir.ST_PROPOSED());
        assert(creator.balance == before);

        (bool early,) = address(mimir).call(abi.encodeWithSelector(MimirV3.finalizeResolution.selector, id));
        assert(!early);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(bob); // anyone may finalize
        mimir.finalizeResolution(id);
        assert(_state(id) == mimir.ST_RESOLVED());
        assert(creator.balance > before);
    }

    function test_onlyParticipantsDisputeAndOnlyInTime() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());

        uint256 bond = mimir.MIN_STAKE();
        vm.prank(bob);
        (bool stranger,) = address(mimir).call{value: bond}(abi.encodeWithSelector(MimirV3.disputeResolution.selector, id));
        assert(!stranger);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        (bool late,) = address(mimir).call{value: bond}(abi.encodeWithSelector(MimirV3.disputeResolution.selector, id));
        assert(!late);
    }

    function test_aRightDisputeFlipsTheVerdictAndReturnsTheBond() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());

        uint256 bond = mimir.MIN_STAKE();
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(id);
        assert(_state(id) == mimir.ST_DISPUTED());

        // The oracle can no longer finalize its own proposal.
        vm.warp(block.timestamp + WINDOW);
        (bool fin,) = address(mimir).call(abi.encodeWithSelector(MimirV3.finalizeResolution.selector, id));
        assert(!fin);

        mimir.resolveDispute(id, mimir.SIDE_CHALLENGERS(), "arbiter", 100, bytes32(uint256(8)));
        assert(_state(id) == mimir.ST_RESOLVED());
        // Alice got her bond back and won the whole pot (no fee on winnings).
        assert(alice.balance - aliceBefore == 2 * STAKE);
    }

    function test_aWrongDisputeForfeitsTheBondToThePlatform() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        uint256 bond = mimir.MIN_STAKE();
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(id);

        uint256 feesBefore = mimir.accruedFees(platform);
        mimir.resolveDispute(id, mimir.SIDE_CREATOR(), "upheld", 95, bytes32(uint256(7)));
        assert(mimir.accruedFees(platform) - feesBefore >= bond);
        assert(address(mimir).balance == mimir.lifetimeFeesAccrued());
    }

    function test_onlyTheArbiterRulesOnADispute() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        uint256 bondAmount = mimir.MIN_STAKE();
        vm.prank(alice);
        mimir.disputeResolution{value: bondAmount}(id);

        vm.prank(oracle);
        (bool ok,) = address(mimir).call(
            abi.encodeWithSelector(MimirV3.resolveDispute.selector, id, uint8(2), "x", uint8(1), bytes32(0))
        );
        assert(!ok);
    }

    function test_anUnruledDisputeSettlesToTheProposalAndForfeitsTheBond() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        uint256 aliceBefore = alice.balance;
        uint256 creatorBefore = creator.balance;
        uint256 bondAmount = mimir.MIN_STAKE();
        vm.prank(alice);
        mimir.disputeResolution{value: bondAmount}(id);

        vm.warp(block.timestamp + mimir.RESOLUTION_GRACE_SECONDS());
        vm.prank(bob);
        mimir.refundExpired(id);
        assert(aliceBefore - alice.balance == bondAmount); // the proposal stands, bond lost
        assert(creator.balance - creatorBefore == 2 * STAKE);
        assert(mimir.accruedFees(platform) == bondAmount);
        assert(_state(id) == mimir.ST_RESOLVED());
    }

    function test_theDisputeWindowIsBounded() public {
        (bool ok,) = address(this).call(abi.encodeWithSelector(this.deployWithWindow.selector, 8 days));
        assert(!ok);
    }

    function deployWithWindow(uint256 window) external {
        new MimirV3(address(this), address(this), oracle, platform, IMimirFees(address(new FlatFees(0))), window, 2e18);
    }
}
