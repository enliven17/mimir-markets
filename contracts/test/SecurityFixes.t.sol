// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MimirV3, IMimirFees} from "../MimirV3.sol";
import {MimirPool, IMimirFees as IPoolFees} from "../MimirPool.sol";
import {MimirFees} from "../MimirFees.sol";
import {FlatFees} from "./FlatFees.sol";

interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function expectRevert(bytes calldata) external;
    function expectRevert(bytes4) external;
    function expectEmit(bool, bool, bool, bool, address) external;
}

abstract contract Base {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant T0 = 1_000_000;

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "not equal");
    }

    function assertEq(address a, address b) internal pure {
        require(a == b, "not equal");
    }

    function assertLt(uint256 a, uint256 b) internal pure {
        require(a < b, "not less");
    }
}

/// A fee contract that can be made to revert, to prove what is checked before it is called.
contract SwitchFees {
    bool public boom;

    function arm() external {
        boom = true;
    }

    function entryBps(address) external view returns (uint16) {
        require(!boom, "fees called");
        return 0;
    }
}

/// A challenger whose receive() burns every unit of gas it is handed.
contract Burner {
    function challenge(MimirV3 m, uint256 id, address ref) external payable {
        m.challengeClaim{value: msg.value}(id, msg.value, "", ref);
    }

    receive() external payable {
        while (gasleft() > 500) {}
    }
}

/**
 * Regression tests for the security review: H-1 (pool odds), M-1 (unruled
 * disputes), pool L-1 / L-2 (copy fees), fees L-3 (signer epoch) and the caps.
 */
contract SecurityFixesTest is Base {
    uint256 constant ONE = 1e18;
    uint256 constant GAP = 1 days;
    uint256 constant WINDOW = 1 days;

    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address creator = address(0xC7ea704);
    address alice = address(0xA11CE);
    address carol = address(0xCA201);
    address ref = address(0x5EF);

    MimirV3 mimir;

    function setUp() public {
        vm.warp(T0);
        mimir = new MimirV3(oracle, platform, IMimirFees(address(new FlatFees(0))), WINDOW, 1e16);
        vm.deal(creator, 10_000 * ONE);
        vm.deal(alice, 10_000 * ONE);
        vm.deal(carol, 10_000 * ONE);
    }

    function _claim(MimirV3 m, uint256 stake, string memory odds, uint256 payoutBps, uint256 deadline)
        internal
        returns (uint256 id)
    {
        vm.prank(creator);
        id = m.createClaim{value: stake}(
            "Will it?", "yes", "no", "https://example.com", deadline, stake,
            "custom", 0, "binary", odds, payoutBps, "", "rule", 0, false, "", address(0)
        );
    }

    function _settleV3(MimirV3 m, uint256 id, uint8 side) internal {
        vm.warp(T0 + GAP + 1);
        vm.prank(oracle);
        m.resolveClaim(id, side, "settled", 90, bytes32(uint256(7)));
        vm.warp(T0 + GAP + 1 + WINDOW);
        m.finalizeResolution(id);
    }

    // -- H-1: a dust challenger wins a matching slice, not the creator's whole stake

    function test_poolOddsCapTheCreatorsRiskAtFiveTimesTheChallengers() public {
        uint256 id = _claim(mimir, 100 * ONE, "pool", 0, T0 + GAP);
        vm.prank(alice);
        mimir.challengeClaim{value: 0.01e18}(id, 0.01e18, "", address(0));
        uint256 c0 = creator.balance;
        uint256 a0 = alice.balance;
        _settleV3(mimir, id, mimir.SIDE_CHALLENGERS());
        assertEq(alice.balance - a0, 0.06e18); // 0.01 back + 5 x 0.01
        assertEq(creator.balance - c0, 99.95e18); // the rest of the stake comes back
        assertEq(address(mimir).balance, 0);
    }

    function test_poolOddsReturnTheRoundingDustToTheCreator() public {
        uint256 id = _claim(mimir, 10 * ONE, "pool", 0, T0 + GAP);
        vm.prank(alice);
        mimir.challengeClaim{value: ONE}(id, ONE, "", address(0));
        vm.prank(carol);
        mimir.challengeClaim{value: 2 * ONE}(id, 2 * ONE, "", address(0));
        uint256 before = creator.balance + alice.balance + carol.balance;
        _settleV3(mimir, id, mimir.SIDE_CHALLENGERS());
        assertEq(creator.balance + alice.balance + carol.balance - before, 13 * ONE); // every wei paid out
        assertEq(address(mimir).balance, 0);
    }

    // -- M-1: an ACTIVE claim nobody resolved is still a full refund

    function test_anUnresolvedActiveClaimIsStillRefunded() public {
        uint256 id = _claim(mimir, 10 * ONE, "pool", 0, T0 + GAP);
        vm.prank(alice);
        mimir.challengeClaim{value: 5 * ONE}(id, 5 * ONE, "", address(0));
        uint256 c0 = creator.balance;
        uint256 a0 = alice.balance;
        vm.warp(T0 + GAP + mimir.RESOLUTION_GRACE_SECONDS());
        mimir.refundExpired(id);
        assertEq(creator.balance - c0, 10 * ONE);
        assertEq(alice.balance - a0, 5 * ONE);
    }

    // -- caps (V3)

    function test_fixedOddsPayAtMostTenTimes() public {
        _claim(mimir, ONE, "fixed", 100_000, T0 + GAP);
        vm.prank(creator);
        vm.expectRevert(bytes("Mimir: payout too high"));
        mimir.createClaim{value: ONE}(
            "Will it?", "yes", "no", "https://example.com", T0 + GAP, ONE,
            "custom", 0, "binary", "fixed", 100_001, "", "rule", 0, false, "", address(0)
        );
    }

    function test_aClaimClosesAtMostAYearOut() public {
        _claim(mimir, ONE, "pool", 0, T0 + 365 days);
        uint256 far = T0 + 365 days + 1;
        vm.prank(creator);
        vm.expectRevert(bytes("Mimir: deadline too far"));
        mimir.createClaim{value: ONE}(
            "Will it?", "yes", "no", "https://example.com", far, ONE,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", address(0)
        );
    }

    function test_aRematchClosesAtMostAYearOut() public {
        uint256 parent = _claim(mimir, ONE, "pool", 0, T0 + GAP);
        uint256 far = T0 + 365 days + 1;
        vm.prank(creator);
        vm.expectRevert(bytes("Mimir: deadline too far"));
        mimir.createRematch{value: ONE}(parent, far, ONE, "");
    }

    function test_anEntryFeeAboveOnePercentIsRefused() public {
        MimirV3 m = new MimirV3(oracle, platform, IMimirFees(address(new FlatFees(101))), WINDOW, 1e16);
        vm.prank(creator);
        vm.expectRevert(bytes("Mimir: entry fee too high"));
        m.createClaim{value: ONE}(
            "Will it?", "yes", "no", "https://example.com", T0 + GAP, ONE,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", address(0)
        );
    }

    function test_theInviteKeyIsCheckedBeforeTheFeeContract() public {
        SwitchFees sw = new SwitchFees();
        MimirV3 m = new MimirV3(oracle, platform, IMimirFees(address(sw)), WINDOW, 1e16);
        vm.prank(creator);
        uint256 id = m.createClaim{value: ONE}(
            "Will it?", "yes", "no", "https://example.com", T0 + GAP, ONE,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, true, "secret", address(0)
        );
        sw.arm();
        vm.prank(alice);
        vm.expectRevert(bytes("Mimir: invalid invite key"));
        m.challengeClaim{value: ONE}(id, ONE, "wrong", address(0));
    }

    function test_cancelReportsTheRefund() public {
        uint256 id = _claim(mimir, 3 * ONE, "pool", 0, T0 + GAP);
        vm.expectEmit(true, false, false, true, address(mimir));
        emit MimirV3.ClaimCancelled(id, 3 * ONE);
        vm.prank(creator);
        mimir.cancelClaim(id);
    }

    // -- gas: a full claim of gas-burning challengers with distinct referrers still settles

    function _fullClaim() internal returns (uint256 id) {
        id = _claim(mimir, 100 * ONE, "pool", 0, T0 + GAP);
        for (uint256 i = 0; i < mimir.MAX_CHALLENGERS(); i++) {
            Burner b = new Burner();
            vm.deal(address(this), ONE);
            b.challenge{value: ONE}(mimir, id, address(uint160(0x10000 + i)));
        }
    }

    function test_aFullClaimOfBurnersFinalizesUnderTheGasLimit() public {
        uint256 id = _fullClaim();
        vm.warp(T0 + GAP + 1);
        uint8 side = mimir.SIDE_CHALLENGERS();
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "settled", 90, bytes32(uint256(7)));
        vm.warp(T0 + GAP + 1 + WINDOW);
        uint256 g = gasleft();
        mimir.finalizeResolution(id);
        g -= gasleft();
        assertLt(g, 16_000_000);
    }

    function test_aFullClaimOfBurnersRefundsUnderTheGasLimit() public {
        uint256 id = _fullClaim();
        vm.warp(T0 + GAP + mimir.RESOLUTION_GRACE_SECONDS());
        uint256 g = gasleft();
        mimir.refundExpired(id);
        g -= gasleft();
        assertLt(g, 16_000_000);
    }
}

/// Pool L-1 / L-2 and the pool caps.
contract PoolSecurityFixesTest is Base {
    uint256 constant ONE = 1e18;
    uint256 constant WINDOW = 1 days;

    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address alice = address(0xA11CE);
    address carol = address(0xCA201);
    address ref = address(0x5EF);

    MimirPool pool;
    uint256 deadline;

    function setUp() public {
        vm.warp(T0);
        deadline = T0 + 1 days;
        pool = new MimirPool(oracle, platform, IPoolFees(address(new FlatFees(0))), WINDOW, 2e18);
        vm.deal(alice, 1_000 * ONE);
        vm.deal(carol, 1_000 * ONE);
    }

    function _settle(uint256 id, uint8 outcome) internal {
        vm.warp(deadline + 1);
        vm.prank(oracle);
        pool.resolve(id, outcome, "proposed", bytes32(uint256(1)));
        vm.warp(deadline + 1 + WINDOW);
        pool.finalize(id);
    }

    // L-1: a hedger pays no copy fee on their own money coming back.
    function test_aHedgerPaysNoCopyFeeOnTheirOwnStake() public {
        vm.prank(alice);
        uint256 id = pool.createMarket{value: 10 * ONE}("q", "Y", "N", "u", "c", deadline, 1, ref);
        vm.prank(alice);
        pool.stake{value: 10 * ONE}(id, 2, address(0));
        _settle(id, 1);
        uint256 b0 = alice.balance;
        pool.claimFor(id, alice);
        assertEq(alice.balance - b0, 20 * ONE);
        assertEq(pool.accruedFees(ref), 0);
        assertEq(pool.accruedFees(platform), 0);
    }

    // L-2: a small copy stake is charged on its own profit, not the whole position's.
    function test_aSmallCopyStakeOnlyPaysOnItsOwnProfit() public {
        vm.prank(alice);
        uint256 id = pool.createMarket{value: 100 * ONE}("q", "Y", "N", "u", "c", deadline, 1, address(0));
        vm.prank(alice);
        pool.stake{value: 2 * ONE}(id, 1, ref);
        vm.prank(carol);
        pool.stake{value: 102 * ONE}(id, 2, address(0));
        assertEq(pool.copyA(id, alice), 2 * ONE);
        _settle(id, 1);
        (uint256 payout, uint256 fee) = pool.claimable(id, alice);
        assertEq(fee, 0.04e18); // 2% of the copy leg's 2 profit
        assertEq(payout, 203.96e18);
        uint256 b0 = alice.balance;
        pool.claimFor(id, alice);
        assertEq(alice.balance - b0, payout); // claimable matches what is paid
        assertEq(pool.accruedFees(ref), 0.02e18);
        assertEq(pool.accruedFees(platform), 0.02e18);
    }

    function test_aMarketClosesAtMostAYearOut() public {
        uint256 far = T0 + 365 days + 1;
        vm.prank(alice);
        vm.expectRevert(MimirPool.BadDeadline.selector);
        pool.createMarket{value: 10 * ONE}("q", "Y", "N", "u", "c", far, 1, address(0));
    }

    function test_aPoolEntryFeeAboveOnePercentIsRefused() public {
        MimirPool p = new MimirPool(oracle, platform, IPoolFees(address(new FlatFees(101))), WINDOW, 2e18);
        vm.prank(alice);
        vm.expectRevert(MimirPool.EntryFeeTooHigh.selector);
        p.createMarket{value: 10 * ONE}("q", "Y", "N", "u", "c", deadline, 1, address(0));
    }
}

/// Fees L-3: rotating the signer retires its tickets; a pending ownership transfer can be cancelled.
contract FeesSecurityFixesTest is Base {
    uint256 constant OLD_KEY = 0xA11;
    uint256 constant NEW_KEY = 0xB22;
    address user = address(0xA11CE);
    MimirFees fees;

    function setUp() public {
        vm.warp(T0);
        fees = new MimirFees(vm.addr(OLD_KEY));
    }

    function _apply(uint256 key, uint8 tier) internal {
        uint64 expires = uint64(T0 + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, fees.ticketDigest(user, tier, expires));
        vm.prank(user);
        fees.applyTicket(tier, expires, abi.encodePacked(r, s, v));
    }

    function test_rotatingTheSignerRetiresItsTickets() public {
        _apply(OLD_KEY, 2);
        assertEq(fees.entryBps(user), fees.WHALE_BPS());
        fees.setSigner(vm.addr(NEW_KEY));
        assertEq(fees.entryBps(user), fees.BASE_BPS());
        _apply(NEW_KEY, 2);
        assertEq(fees.entryBps(user), fees.WHALE_BPS());
    }

    function test_aPendingOwnershipTransferCanBeCancelled() public {
        address next = address(0xBEEF);
        fees.transferOwnership(next);
        fees.cancelOwnershipTransfer();
        assertEq(fees.pendingOwner(), address(0));
        vm.warp(T0 + 3 days);
        vm.prank(next);
        vm.expectRevert(MimirFees.NotPendingOwner.selector);
        fees.acceptOwnership();
    }

    function test_onlyTheOwnerCancelsAndOnlyWhatIsPending() public {
        vm.expectRevert(MimirFees.NotPendingOwner.selector);
        fees.cancelOwnershipTransfer();
        fees.transferOwnership(address(0xBEEF));
        vm.prank(address(0xBEEF));
        vm.expectRevert(MimirFees.NotOwner.selector);
        fees.cancelOwnershipTransfer();
    }
}
