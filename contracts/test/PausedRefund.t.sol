// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MimirV3, IMimirFees as IVsFees} from "../MimirV3.sol";
import {MimirPool, IMimirFees as IPoolFees} from "../MimirPool.sol";
import {FlatFees} from "./FlatFees.sol";

interface VmPausedRefund {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

contract PausedRefundTest {
    VmPausedRefund constant vm = VmPausedRefund(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant T0 = 1_000_000;
    uint256 constant DEADLINE = T0 + 1 days;
    uint256 constant PROPOSED = DEADLINE + 1;
    uint256 constant STAKE = 10e18;
    address constant CREATOR = address(0xC0);
    address constant ALICE = address(0xA1);
    address constant BOB = address(0xB0);
    address constant ORACLE = address(0x0123);
    MimirV3 vs;
    MimirPool pool;

    function setUp() public {
        vm.warp(T0);
        address fees = address(new FlatFees(0));
        vs = new MimirV3(address(this), address(this), ORACLE, address(0xFEE), IVsFees(fees), 1 days, 1e16);
        pool = new MimirPool(address(this), address(this), ORACLE, address(0xFEE), IPoolFees(fees), 1 days, 1e16);
        vm.deal(CREATOR, 1_000e18);
        vm.deal(ALICE, 1_000e18);
        vm.deal(BOB, 1_000e18);
    }

    function _create(bool restricted, string memory mode, uint256 slots, string memory key) internal returns (uint256) {
        vm.prank(CREATOR);
        return vs.createClaim{value: STAKE}("Q?", "Yes", "No", "https://example.com", DEADLINE, STAKE,
            "custom", 0, "binary", mode, 20_000, "", "", slots, restricted, key, address(0));
    }

    function _challenge(address who, uint256 id, string memory key) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(vs).call{value: STAKE}(abi.encodeWithSelector(MimirV3.challengeClaim.selector, id, STAKE, key, address(0)));
    }

    function test_pausedVsUndisputedProposalRefundsAfterWindowAndGrace() public {
        uint256 id = _create(false, "pool", 0, "");
        require(_challenge(ALICE, id, ""));
        vm.warp(PROPOSED);
        vm.prank(ORACLE);
        vs.resolveClaim(id, 1, "proposal", 95, bytes32(0));
        vm.warp(PROPOSED + 1 days);
        vs.setPaused(true);
        vm.warp(PROPOSED + 7 days);
        vs.refundExpired(id);
        require(CREATOR.balance == 1_000e18 && ALICE.balance == 1_000e18);
        (bool replay,) = address(vs).call(abi.encodeCall(MimirV3.refundExpired, (id)));
        require(!replay);
        vs.setPaused(false);
        (bool finalized,) = address(vs).call(abi.encodeCall(MimirV3.finalizeResolution, (id)));
        require(!finalized && address(vs).balance == 0);
    }

    function test_pausedPoolUndisputedProposalRefundsAfterWindowAndGrace() public {
        vm.prank(CREATOR);
        uint256 id = pool.createMarket{value: STAKE}("Q?", "Yes", "No", "u", "sports", DEADLINE, 1, address(0));
        vm.prank(ALICE);
        pool.stake{value: STAKE}(id, 2, address(0));
        vm.warp(PROPOSED);
        vm.prank(ORACLE);
        pool.resolve(id, 1, "proposal", bytes32(0));
        vm.warp(PROPOSED + 1 days);
        pool.setPaused(true);
        vm.warp(PROPOSED + 7 days);
        pool.refundExpired(id);
        pool.claimFor(id, CREATOR);
        pool.claimFor(id, ALICE);
        require(CREATOR.balance == 1_000e18 && ALICE.balance == 1_000e18);
        (bool replay,) = address(pool).call(abi.encodeCall(MimirPool.claimFor, (id, ALICE)));
        require(!replay && address(pool).balance == 0);
    }

    function test_lateVsProposalGetsAFullGraceAndUnpausedProposalCannotRefund() public {
        uint256 id = _create(false, "pool", 0, "");
        require(_challenge(ALICE, id, ""));
        uint256 late = DEADLINE + 6 days;
        vm.warp(late);
        vm.prank(ORACLE);
        vs.resolveClaim(id, 1, "late", 95, bytes32(0));
        vs.setPaused(true);
        vm.warp(late + 7 days - 1);
        (bool early,) = address(vs).call(abi.encodeCall(MimirV3.refundExpired, (id)));
        require(!early);
        vm.warp(late + 7 days);
        vs.setPaused(false);
        (bool unpausedRefund,) = address(vs).call(abi.encodeCall(MimirV3.refundExpired, (id)));
        require(!unpausedRefund);
        vs.setPaused(true);
        vs.refundExpired(id);
        require(CREATOR.balance == 1_000e18 && ALICE.balance == 1_000e18);
    }

    function test_latePoolProposalGetsAFullGraceAndUnpausedProposalCannotRefund() public {
        vm.prank(CREATOR);
        uint256 id = pool.createMarket{value: STAKE}("Q?", "Yes", "No", "u", "sports", DEADLINE, 1, address(0));
        vm.prank(ALICE);
        pool.stake{value: STAKE}(id, 2, address(0));
        uint256 late = DEADLINE + 6 days;
        vm.warp(late);
        vm.prank(ORACLE);
        pool.resolve(id, 1, "late", bytes32(0));
        pool.setPaused(true);
        vm.warp(late + 7 days - 1);
        (bool early,) = address(pool).call(abi.encodeCall(MimirPool.refundExpired, (id)));
        require(!early);
        vm.warp(late + 7 days);
        pool.setPaused(false);
        (bool unpausedRefund,) = address(pool).call(abi.encodeCall(MimirPool.refundExpired, (id)));
        require(!unpausedRefund);
        pool.setPaused(true);
        pool.refundExpired(id);
        pool.claimFor(id, CREATOR);
        pool.claimFor(id, ALICE);
        require(CREATOR.balance == 1_000e18 && ALICE.balance == 1_000e18);
    }

    function test_productionRuntimeFitsEip170() public view {
        require(address(vs).code.length <= 24_576 && address(pool).code.length <= 24_576);
    }
}
