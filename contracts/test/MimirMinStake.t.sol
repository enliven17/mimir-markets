// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3, IMimirFees} from "../MimirV3.sol";
import {MimirPool, IMimirFees as IPoolFees} from "../MimirPool.sol";
import {FlatFees} from "./FlatFees.sol";

/**
 * The stake minimum is a deploy parameter (0.01 to 100 USDC) so mainnet can open
 * with 0.1 USDC markets, while the dispute bond stays a fixed 2 USDC: cheap bets
 * must not make disputes cheap to spam. Settlement and fees still add up at
 * these sizes (0.5% of 0.1 USDC is 0.0005 USDC, exact at 18 decimals).
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function expectRevert(bytes calldata) external;
    function expectRevert(bytes4) external;
}

contract MimirMinStakeTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3 mimir;
    MimirPool pool;
    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address creator = address(0xC7ea704);
    address alice = address(0xA11CE);

    uint256 constant MIN = 1e17; // 0.1 USDC
    uint256 constant GAP = 1 days;

    function setUp() public {
        vm.warp(1_000_000);
        IMimirFees fees = IMimirFees(address(new FlatFees(50)));
        mimir = new MimirV3(oracle, platform, fees, 0, MIN);
        pool = new MimirPool(oracle, platform, IPoolFees(address(fees)), 0, MIN);
        vm.deal(creator, 100e18);
        vm.deal(alice, 100e18);
    }

    function _create(uint256 stake) internal returns (uint256 id) {
        vm.prank(creator);
        id = mimir.createClaim{value: stake}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, stake, "custom", 0, "binary",
            "pool", 0, "", "", 0, false, "", address(0)
        );
    }

    function test_constructorRefusesAMinimumOutOfRange() public {
        IMimirFees fees = IMimirFees(address(new FlatFees(0)));
        vm.expectRevert(bytes("Mimir: min stake out of range"));
        new MimirV3(oracle, platform, fees, 0, 1e15);
        vm.expectRevert(bytes("Mimir: min stake out of range"));
        new MimirV3(oracle, platform, fees, 0, 101e18);
        vm.expectRevert(MimirPool.BadMinStake.selector);
        new MimirPool(oracle, platform, IPoolFees(address(fees)), 0, 1e15);
    }

    function test_vsTakesTenCentStakesAndRefusesLess() public {
        uint256 id = _create(MIN);
        require(id == 1, "created");
        vm.prank(creator);
        vm.expectRevert(bytes("Mimir: stake too small"));
        mimir.createClaim{value: MIN - 1}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, MIN - 1, "custom", 0, "binary",
            "pool", 0, "", "", 0, false, "", address(0)
        );
        vm.prank(alice);
        mimir.challengeClaim{value: MIN}(id, MIN, "", address(0));
    }

    function test_tenCentDuelSettlesExactly() public {
        uint256 id = _create(MIN);
        vm.prank(alice);
        mimir.challengeClaim{value: MIN}(id, MIN, "", address(0));
        uint256 net = MIN - (MIN * 50) / 10_000; // 0.0995 each
        vm.warp(block.timestamp + GAP);
        uint256 before = alice.balance;
        vm.prank(oracle);
        mimir.resolveClaim(id, 2, "challengers win", 90, bytes32(0));
        // The winner gets both net stakes back, no fee on winnings.
        require(alice.balance - before == 2 * net, "challenger paid both stakes");
        require(address(mimir).balance == mimir.accruedFees(platform), "only the entry fees stay behind");
        require(mimir.accruedFees(platform) == 2 * ((MIN * 50) / 10_000), "two entry fees of 0.0005");
    }

    function test_disputeBondStaysTwoUsdcWhateverTheMinimum() public {
        IMimirFees fees = IMimirFees(address(new FlatFees(0)));
        MimirV3 windowed = new MimirV3(oracle, platform, fees, 1 hours, MIN);
        vm.prank(creator);
        uint256 id = windowed.createClaim{value: MIN}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, MIN, "custom", 0, "binary",
            "pool", 0, "", "", 0, false, "", address(0)
        );
        vm.prank(alice);
        windowed.challengeClaim{value: MIN}(id, MIN, "", address(0));
        vm.warp(block.timestamp + GAP);
        vm.prank(oracle);
        windowed.resolveClaim(id, 1, "creator wins", 90, bytes32(0));
        vm.prank(alice);
        vm.expectRevert(bytes("Mimir: wrong USDC value"));
        windowed.disputeResolution{value: MIN}(id);
        vm.prank(alice);
        windowed.disputeResolution{value: 2e18}(id);
    }

    function test_poolTakesTenCentStakes() public {
        vm.prank(creator);
        uint256 id = pool.createMarket{value: MIN}("Will it?", "A", "B", "https://example.com", "custom", block.timestamp + GAP, 1, address(0));
        vm.prank(alice);
        pool.stake{value: MIN}(id, 2, address(0));
        vm.prank(alice);
        vm.expectRevert(MimirPool.StakeTooSmall.selector);
        pool.stake{value: MIN - 1}(id, 2, address(0));
    }
}
