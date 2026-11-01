// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirPoolErc20, IMimirFees, IUsdc} from "../MimirPoolErc20.sol";
import {MimirFees} from "../MimirFees.sol";
import {FlatFees} from "./FlatFees.sol";
import {MockUsdc} from "./MockUsdc.sol";

/**
 * MimirPoolErc20 (Base: USDC as an ERC-20, 6 decimals). The important cases of
 * MimirPool.t.sol ported to the pulled-stake transport, plus what is new:
 * fee math at 6 decimals, the balance-delta check, permit, a token without a
 * return value, and a blacklisted winner whose payout is parked.
 * Dependency-free, absolute timestamps (via-IR can cache block.timestamp).
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
}

contract MimirPoolErc20Test {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirPoolErc20 pool;
    MockUsdc usdc;
    MimirFees fees;

    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address keeper = address(0xB0B);
    address alice = address(0xA11CE);
    address carol = address(0xCA201);
    address dave = address(0xDA7E);
    address referrer = address(0xA6E7);
    address cold = address(0xC01D);

    uint256 constant ONE = 1e6;
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
        usdc = new MockUsdc();
        fees = new MimirFees(address(this), address(0x5161));
        usdc.mint(alice, 100 * ONE);
        usdc.mint(carol, 100 * ONE);
        usdc.mint(dave, 100 * ONE);
        _use(_deploy(IMimirFees(address(new FlatFees(0))), 2 * ONE));
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _deploy(IMimirFees f, uint256 minStake) internal returns (MimirPoolErc20) {
        return new MimirPoolErc20(address(this), address(this), oracle, platform, f, WINDOW, minStake, IUsdc(address(usdc)));
    }

    function _use(MimirPoolErc20 p) internal {
        pool = p;
        address[3] memory who = [alice, carol, dave];
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(who[i]);
            usdc.approve(address(p), type(uint256).max);
        }
    }

    function _create(address who, uint256 amount, uint8 side) internal returns (uint256 id) {
        vm.prank(who);
        id = pool.createMarket("Will it?", "YES", "NO", "https://example.com", "custom", DEADLINE, side, address(0), amount);
    }

    function _stake(address who, uint256 id, uint256 amount, uint8 side) internal {
        vm.prank(who);
        pool.stake(id, side, address(0), amount);
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

    function _bal(address a) internal view returns (uint256) {
        return usdc.balanceOf(a);
    }

    function _err(bytes4 sel) internal pure returns (bytes32) {
        return keccak256(abi.encodeWithSelector(sel));
    }

    function _claimCall(uint256 id, address user) internal returns (bool ok, bytes memory ret) {
        (ok, ret) = address(pool).call(abi.encodeWithSelector(MimirPoolErc20.claimFor.selector, id, user));
    }

    // ── Constants and constructor ───────────────────────────────────────────

    function test_constantsAreSixDecimals() public view {
        assert(pool.MIN_STAKE_FLOOR() == 1e4 && pool.MIN_STAKE_CEILING() == 100e6);
        assert(pool.DISPUTE_BOND() == 2e6 && pool.MIN_STAKE() == 2e6);
        assert(address(pool.usdc()) == address(usdc));
    }

    function deployExternal(uint256 minStake, address token) external returns (address) {
        return address(new MimirPoolErc20(address(this), address(this), oracle, platform, IMimirFees(address(fees)), 0, minStake, IUsdc(token)));
    }

    function test_constructorBounds() public {
        (bool lo, bytes memory r1) = address(this).call(abi.encodeWithSelector(this.deployExternal.selector, 1e4 - 1, address(usdc)));
        (bool hi,) = address(this).call(abi.encodeWithSelector(this.deployExternal.selector, 100e6 + 1, address(usdc)));
        (bool noCode, bytes memory r3) = address(this).call(abi.encodeWithSelector(this.deployExternal.selector, 1e4, address(0xdead)));
        assert(!lo && !hi && !noCode);
        assert(keccak256(r1) == _err(MimirPoolErc20.BadMinStake.selector));
        assert(keccak256(r3) == _err(MimirPoolErc20.NoCode.selector));
        this.deployExternal(1e4, address(usdc));
        this.deployExternal(100e6, address(usdc));
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    function test_fullLifecycle() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(alice, id, 5 * ONE, A); // stakes add up
        _stake(carol, id, 20 * ONE, B);
        _stake(dave, id, 5 * ONE, A);
        assert(_bal(address(pool)) == 40 * ONE);
        (uint256 totalA, uint256 totalB) = pool.sideTotals(id);
        assert(totalA == 20 * ONE && totalB == 20 * ONE);

        _settle(id, A);
        (uint256 owed, uint256 fee) = pool.claimable(id, alice);
        assert(owed == 30 * ONE && fee == 0);
        vm.prank(alice);
        pool.claim(id);
        vm.prank(keeper);
        pool.claimFor(id, dave); // anyone pushes
        assert(_bal(alice) == 85 * ONE + 30 * ONE);
        assert(_bal(dave) == 95 * ONE + 10 * ONE);

        (bool lost, bytes memory r1) = _claimCall(id, carol);
        assert(!lost && keccak256(r1) == _err(MimirPoolErc20.NothingToClaim.selector));
        (bool twice, bytes memory r2) = _claimCall(id, alice);
        assert(!twice && keccak256(r2) == _err(MimirPoolErc20.AlreadyClaimed.selector));
        assert(_bal(address(pool)) == 0);
    }

    function test_dustStaysInThePot() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 3 * ONE, B);
        _stake(dave, id, 4 * ONE, B);
        _settle(id, B);
        pool.claimFor(id, carol);
        pool.claimFor(id, dave);
        uint256 paid = (_bal(carol) - 97 * ONE) + (_bal(dave) - 96 * ONE);
        assert(paid <= 17 * ONE && 17 * ONE - paid <= 2); // at most 1 unit per winner
        assert(_bal(address(pool)) == 17 * ONE - paid);
    }

    function test_aDrawRefundsBothSides() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 6 * ONE, B);
        _settle(id, DRAW);
        pool.claimFor(id, alice);
        pool.claimFor(id, carol);
        assert(_bal(alice) == 100 * ONE && _bal(carol) == 100 * ONE && _bal(address(pool)) == 0);
    }

    // ── Entry: pulled with transferFrom ─────────────────────────────────────

    function test_stakesNeedAnAllowanceAndTheMinimum() public {
        uint256 id = _create(alice, 10 * ONE, A);
        address broke = address(0xB10C);
        usdc.mint(broke, 10 * ONE);
        vm.prank(broke);
        (bool noAllowance,) = address(pool).call(abi.encodeWithSelector(MimirPoolErc20.stake.selector, id, B, address(0), 2 * ONE));
        vm.prank(carol);
        (bool small, bytes memory r) = address(pool).call(abi.encodeWithSelector(MimirPoolErc20.stake.selector, id, B, address(0), 2 * ONE - 1));
        assert(!noAllowance && !small);
        assert(keccak256(r) == _err(MimirPoolErc20.StakeTooSmall.selector));
    }

    function test_nativeValueIsRefused() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool plain,) = address(pool).call{value: 1}("");
        uint256 id = _create(alice, 10 * ONE, A);
        vm.prank(alice);
        (bool withStake,) = address(pool).call{value: 1}(abi.encodeWithSelector(MimirPoolErc20.stake.selector, id, A, address(0), 2 * ONE));
        assert(!plain && !withStake);
    }

    function test_aShortDeliveryIsRefused() public {
        usdc.setSkim(1);
        vm.prank(alice);
        (bool ok, bytes memory r) = address(pool).call(abi.encodeWithSelector(
            MimirPoolErc20.createMarket.selector, "q", "Y", "N", "u", "c", DEADLINE, A, address(0), 10 * ONE
        ));
        assert(!ok && keccak256(r) == _err(MimirPoolErc20.TransferFailed.selector));
    }

    function test_aTokenWithoutReturnValueWorksEndToEnd() public {
        usdc.setNoBool(true);
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        _settle(id, B);
        pool.claimFor(id, carol);
        assert(_bal(carol) == 110 * ONE && _bal(address(pool)) == 0);
    }

    // ── Fees at 6 decimals ──────────────────────────────────────────────────

    function test_entryFeeAtTheOneCentFloor() public {
        _use(_deploy(IMimirFees(address(fees)), 1e4));
        uint256 id = _create(alice, 1e4, A); // 0.5% of 0.01 USDC = 50 units
        _stake(carol, id, 1e4, B);
        (uint256 a, uint256 b) = pool.sideTotals(id);
        assert(a == 1e4 - 50 && b == 1e4 - 50);
        assert(pool.accruedFees(platform) == 100);
        _settle(id, A);
        pool.claimFor(id, alice);
        assert(_bal(alice) == 100 * ONE - 1e4 + 2 * (1e4 - 50));
        vm.prank(platform);
        pool.claimFees();
        assert(_bal(platform) == 100 && _bal(address(pool)) == 0);
    }

    function test_aCopyTradePaysOnProfit() public {
        _use(_deploy(IMimirFees(address(new FlatFees(0))), 2 * ONE));
        uint256 id = _create(alice, 10 * ONE, B);
        vm.prank(carol);
        pool.stake(id, A, referrer, 10 * ONE);
        _settle(id, A);
        (uint256 owed, uint256 fee) = pool.claimable(id, carol);
        // 10 profit: 1% to the referrer, 1% to the platform.
        assert(fee == 2 * (10 * ONE) / 100 && owed == 20 * ONE - fee);
        pool.claimFor(id, carol);
        assert(_bal(carol) == 90 * ONE + owed);
        assert(pool.accruedFees(referrer) == ONE / 10 && pool.accruedFees(platform) == ONE / 10);
        vm.prank(referrer);
        pool.claimFeesTo(cold);
        assert(_bal(cold) == ONE / 10);
    }

    // ── A blacklisted winner is parked ──────────────────────────────────────

    function test_aBlacklistedWinnerIsParkedAndPullsElsewhere() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        _stake(dave, id, 10 * ONE, B);
        _settle(id, B);
        usdc.blacklist(carol, true);

        vm.prank(keeper);
        pool.claimFor(id, carol); // does not revert
        assert(pool.pendingWithdrawals(carol) == 15 * ONE && pool.claimed(id, carol));
        pool.claimFor(id, dave); // the other winner is unaffected
        assert(_bal(dave) == 105 * ONE);

        vm.prank(carol);
        (bool own,) = address(pool).call(abi.encodeWithSelector(MimirPoolErc20.withdraw.selector));
        assert(!own);
        vm.prank(carol);
        pool.withdrawTo(cold);
        assert(_bal(cold) == 15 * ONE && _bal(address(pool)) == 0);
    }

    // ── Disputes ────────────────────────────────────────────────────────────

    function _disputed() internal returns (uint256 id) {
        id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        _propose(id, A);
        vm.prank(carol);
        pool.dispute(id);
        assert(_state(id) == pool.ST_DISPUTED());
        assert(_bal(carol) == 88 * ONE); // the bond was pulled
    }

    function test_aRightDisputeFlipsAndReturnsTheBond() public {
        uint256 id = _disputed();
        pool.resolveDispute(id, B, "arbiter", bytes32(uint256(2)));
        assert(_bal(carol) == 90 * ONE);
        pool.claimFor(id, carol);
        assert(_bal(carol) == 110 * ONE);
    }

    function test_aWrongDisputeForfeitsTheBond() public {
        uint256 id = _disputed();
        pool.resolveDispute(id, A, "upheld", bytes32(uint256(1)));
        assert(pool.accruedFees(platform) == 2 * ONE && _bal(carol) == 88 * ONE);
    }

    function test_aBlacklistedDisputerHasTheBondParked() public {
        uint256 id = _disputed();
        usdc.blacklist(carol, true);
        pool.resolveDispute(id, B, "arbiter", bytes32(uint256(2)));
        assert(pool.pendingWithdrawals(carol) == 2 * ONE);
    }

    function test_onlyParticipantsDisputeWithTheBond() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        _propose(id, A);
        vm.prank(dave);
        (bool stranger, bytes memory r) = address(pool).call(abi.encodeWithSelector(MimirPoolErc20.dispute.selector, id));
        assert(!stranger && keccak256(r) == _err(MimirPoolErc20.NotParticipant.selector));
        vm.prank(carol);
        usdc.approve(address(pool), 0);
        vm.prank(carol);
        (bool noBond,) = address(pool).call(abi.encodeWithSelector(MimirPoolErc20.dispute.selector, id));
        assert(!noBond && _state(id) == pool.ST_PROPOSED());
    }

    // ── Escape hatch and pause ──────────────────────────────────────────────

    function test_anUnresolvedMarketIsRefundedAfterTheGrace() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 4 * ONE, B);
        vm.warp(DEADLINE + 7 days);
        vm.prank(keeper);
        pool.refundExpired(id);
        pool.claimFor(id, alice);
        pool.claimFor(id, carol);
        assert(_bal(alice) == 100 * ONE && _bal(carol) == 100 * ONE);
    }

    function test_pauseBlocksStakesAndWinnersButNotRefunds() public {
        uint256 id = _create(alice, 10 * ONE, A);
        _stake(carol, id, 10 * ONE, B);
        uint256 lone = _create(dave, 10 * ONE, A); // one-sided: a refund whatever the outcome

        pool.setPaused(true);
        vm.prank(carol);
        (bool st, bytes memory r0) = address(pool).call(abi.encodeWithSelector(MimirPoolErc20.stake.selector, id, B, address(0), 2 * ONE));
        assert(!st && keccak256(r0) == _err(MimirPoolErc20.IsPaused.selector));
        pool.setPaused(false);

        vm.warp(AFTER);
        vm.prank(oracle);
        pool.resolve(id, A, "a", bytes32(0));
        vm.prank(oracle);
        pool.resolve(lone, A, "a", bytes32(0));
        vm.warp(AFTER + WINDOW);
        pool.finalize(id);
        pool.finalize(lone);

        pool.setPaused(true);
        (bool win, bytes memory r) = _claimCall(id, alice);
        assert(!win && keccak256(r) == _err(MimirPoolErc20.IsPaused.selector));
        pool.claimFor(lone, dave); // a refund is paid while paused
        assert(_bal(dave) == 100 * ONE);

        pool.setPaused(false);
        pool.claimFor(id, alice);
        assert(_bal(alice) == 110 * ONE);
    }

    // ── Permit ──────────────────────────────────────────────────────────────

    function _permitSig(uint256 pk, uint256 value, uint256 deadline) internal returns (uint8 v, bytes32 r, bytes32 s) {
        address owner_ = vm.addr(pk);
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            usdc.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(usdc.PERMIT_TYPEHASH(), owner_, address(pool), value, usdc.nonces(owner_), deadline))
        ));
        (v, r, s) = vm.sign(pk, digest);
    }

    function test_permitVariantsNeedNoApprove() public {
        uint256 pk = 0x5EC12E7;
        address signer = vm.addr(pk);
        usdc.mint(signer, 20 * ONE);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(pk, 10 * ONE, T0 + 1 hours);
        vm.prank(signer);
        uint256 id = pool.createMarketWithPermit(
            "Will it?", "YES", "NO", "u", "custom", DEADLINE, A, address(0), 10 * ONE, T0 + 1 hours, v, r, s
        );
        (v, r, s) = _permitSig(pk, 10 * ONE, T0 + 1 hours);
        vm.prank(signer);
        pool.stakeWithPermit(id, B, address(0), 10 * ONE, T0 + 1 hours, v, r, s);
        (uint256 onA, uint256 onB) = pool.stakeOf(id, signer);
        assert(onA == 10 * ONE && onB == 10 * ONE && _bal(signer) == 0);
    }

    function test_disputeWithPermit() public {
        uint256 pk = 0xD15;
        address signer = vm.addr(pk);
        usdc.mint(signer, 12 * ONE);
        vm.prank(signer);
        usdc.approve(address(pool), 10 * ONE);
        uint256 id = _create(alice, 10 * ONE, A);
        vm.prank(signer);
        pool.stake(id, B, address(0), 10 * ONE);
        _propose(id, A);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(pk, 2 * ONE, AFTER + 1 hours);
        vm.prank(signer);
        pool.disputeWithPermit(id, AFTER + 1 hours, v, r, s);
        assert(_state(id) == pool.ST_DISPUTED() && _bal(signer) == 0);
    }
}
