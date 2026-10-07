// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3, IMimirFees} from "../MimirV3.sol";
import {FlatFees} from "./FlatFees.sol";

/**
 * Safety properties added after the September 2026 review: the oracle-timeout
 * escape hatch, gas-capped settlement pushes, two-step ownership, the oracle
 * timelock, pausing, and the odds paths the first suite did not reach.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

/** A winner whose receive() burns every unit of gas it is given. */
contract GasBurner {
    receive() external payable {
        while (true) {}
    }

    function challenge(MimirV3 m, uint256 id, uint256 stake) external payable {
        m.challengeClaim{value: stake}(id, stake, "", address(0));
    }
}

contract MimirV3SafetyTest {
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

    function setUp() public {
        vm.warp(1_000_000);
        mimir = new MimirV3(oracle, platform, IMimirFees(address(new FlatFees(50))), 0);
        vm.deal(creator, 1_000 * ONE);
        vm.deal(alice, 1_000 * ONE);
        vm.deal(bob, 1_000 * ONE);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /// What is staked after the 0.5% entry fee.
    function _net(uint256 amount) internal pure returns (uint256) {
        return amount - (amount * 50) / 10_000;
    }

    function _createCall(uint256 stake, string memory oddsMode, uint256 payoutBps, bool isPrivate, string memory key)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeWithSelector(
            MimirV3.createClaim.selector,
            "Will it?", "yes", "no", "https://example.com",
            block.timestamp + GAP, stake, "custom", uint256(0), "binary",
            oddsMode, payoutBps, "", "resolve from the source", uint256(0),
            isPrivate, key, address(0)
        );
    }

    function _create(uint256 stake, string memory oddsMode, uint256 payoutBps) internal returns (uint256 id) {
        vm.prank(creator);
        (bool ok, bytes memory ret) = address(mimir).call{value: stake}(_createCall(stake, oddsMode, payoutBps, false, ""));
        require(ok, "create failed");
        id = abi.decode(ret, (uint256));
    }

    function _challenge(address who, uint256 id, uint256 stake) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(mimir).call{value: stake}(
            abi.encodeWithSelector(MimirV3.challengeClaim.selector, id, stake, "", address(0))
        );
    }

    function _state(uint256 id) internal view returns (uint8 state, uint8 side) {
        (,,,,,,,,, state, side,,,,,,,) = mimir.getClaim(id);
    }

    function _resolve(uint256 id, uint8 side) internal {
        vm.warp(block.timestamp + GAP + 1);
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "because", 90, bytes32(uint256(1)));
    }

    // ── Escape hatch ────────────────────────────────────────────────────────

    function test_anUnresolvedClaimCanBeRefundedAfterTheGrace() public {
        uint256 id = _create(STAKE, "pool", 0);
        assert(_challenge(alice, id, STAKE));

        // Not while the oracle still has time.
        vm.warp(block.timestamp + GAP + mimir.RESOLUTION_GRACE_SECONDS() - 1);
        (bool early,) = address(mimir).call(abi.encodeWithSelector(MimirV3.refundExpired.selector, id));
        assert(!early);

        uint256 creatorBefore = creator.balance;
        uint256 aliceBefore = alice.balance;
        vm.warp(block.timestamp + 1);
        vm.prank(bob); // anyone
        mimir.refundExpired(id);

        // Net stakes back; the entry fees stay earned.
        assert(creator.balance - creatorBefore == _net(STAKE));
        assert(alice.balance - aliceBefore == _net(STAKE));
        (uint8 state, uint8 side) = _state(id);
        assert(state == mimir.ST_RESOLVED());
        assert(side == mimir.SIDE_UNRESOLVABLE());
        assert(mimir.lifetimeFeesAccrued() == 2 * (STAKE - _net(STAKE)));
    }

    function test_aResolvedClaimCannotBeRefundedAgain() public {
        uint256 id = _create(STAKE, "pool", 0);
        assert(_challenge(alice, id, STAKE));
        _resolve(id, mimir.SIDE_CREATOR());

        vm.warp(block.timestamp + mimir.RESOLUTION_GRACE_SECONDS() + 1);
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(MimirV3.refundExpired.selector, id));
        assert(!ok);
    }

    // ── Gas-capped pushes ───────────────────────────────────────────────────

    function test_aGasBurningWinnerCannotBlockSettlement() public {
        GasBurner burner = new GasBurner();
        vm.deal(address(burner), 100 * ONE);

        uint256 id = _create(STAKE, "pool", 0);
        burner.challenge{value: STAKE}(mimir, id, STAKE);
        assert(_challenge(alice, id, STAKE));

        uint256 aliceBefore = alice.balance;
        // A realistic gas budget: with all gas forwarded, the burner would eat
        // 63/64 of it and leave too little to pay Alice or finish the loop.
        vm.warp(block.timestamp + GAP + 1);
        // Encoded before the prank: reading SIDE_CHALLENGERS() is itself a call
        // and would consume it.
        bytes memory resolve = abi.encodeWithSelector(
            MimirV3.resolveClaim.selector, id, mimir.SIDE_CHALLENGERS(), "because", uint8(90), bytes32(uint256(1))
        );
        vm.prank(oracle);
        (bool settled,) = address(mimir).call{gas: 1_000_000}(resolve);
        assert(settled);

        // Settlement completed, Alice was paid, the burner's share is parked.
        (uint8 state,) = _state(id);
        assert(state == mimir.ST_RESOLVED());
        assert(alice.balance > aliceBefore);
        assert(mimir.pendingWithdrawals(address(burner)) > 0);
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    function test_ownershipTransferIsTwoStep() public {
        mimir.transferOwnership(alice);
        assert(mimir.owner() == address(this));
        assert(mimir.pendingOwner() == alice);

        vm.prank(bob);
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(MimirV3.acceptOwnership.selector));
        assert(!stranger);

        vm.warp(block.timestamp + mimir.OWNERSHIP_TIMELOCK_SECONDS());
        vm.prank(alice);
        mimir.acceptOwnership();
        assert(mimir.owner() == alice);
        assert(mimir.pendingOwner() == address(0));
    }

    function test_ownershipCannotGoToZero() public {
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(MimirV3.transferOwnership.selector, address(0)));
        assert(!ok);
    }

    function test_anOracleChangeIsTimelocked() public {
        mimir.queueOracle(alice);

        (bool early,) = address(mimir).call(abi.encodeWithSelector(MimirV3.executeOracle.selector));
        assert(!early);
        assert(mimir.oracle() == oracle);

        vm.warp(block.timestamp + mimir.ORACLE_TIMELOCK_SECONDS());
        vm.prank(bob); // permissionless once due
        mimir.executeOracle();
        assert(mimir.oracle() == alice);
    }

    function test_aQueuedOracleChangeCanBeCancelled() public {
        mimir.queueOracle(alice);
        mimir.cancelOracle();
        vm.warp(block.timestamp + 3 days);
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(MimirV3.executeOracle.selector));
        assert(!ok);
        assert(mimir.oracle() == oracle);
    }

    function test_onlyTheOwnerAdministers() public {
        vm.prank(bob);
        (bool a,) = address(mimir).call(abi.encodeWithSelector(MimirV3.queueOracle.selector, bob));
        vm.prank(bob);
        (bool b,) = address(mimir).call(abi.encodeWithSelector(MimirV3.setPaused.selector, true));
        assert(!a && !b);
    }

    function test_pauseStopsNewPositionsButNeverSettlement() public {
        uint256 id = _create(STAKE, "pool", 0);
        assert(_challenge(alice, id, STAKE));

        mimir.setPaused(true);

        vm.prank(creator);
        (bool created,) = address(mimir).call{value: STAKE}(_createCall(STAKE, "pool", 0, false, ""));
        assert(!created);
        assert(!_challenge(bob, id, STAKE));

        // Settlement and fee claims keep working while paused.
        _resolve(id, mimir.SIDE_CREATOR());
        vm.prank(platform);
        mimir.claimFees();

        mimir.setPaused(false);
        assert(_create(STAKE, "pool", 0) > id);
    }

    // ── Claim rules ─────────────────────────────────────────────────────────

    function test_aPrivateClaimNeedsAnInviteKey() public {
        vm.prank(creator);
        (bool noKey,) = address(mimir).call{value: STAKE}(_createCall(STAKE, "pool", 0, true, ""));
        assert(!noKey);

        vm.prank(creator);
        (bool withKey, bytes memory ret) = address(mimir).call{value: STAKE}(_createCall(STAKE, "pool", 0, true, "s3cret"));
        assert(withKey);
        uint256 id = abi.decode(ret, (uint256));

        assert(!_challenge(alice, id, STAKE)); // wrong (empty) key
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "s3cret", address(0));
    }

    function test_feesCanBeClaimedToAnotherAddress() public {
        uint256 id = _create(STAKE, "pool", 0);
        assert(_challenge(alice, id, STAKE));
        _resolve(id, mimir.SIDE_CREATOR());

        uint256 owed = mimir.accruedFees(platform);
        uint256 before = bob.balance;
        vm.prank(platform);
        mimir.claimFeesTo(bob);
        assert(bob.balance - before == owed);
        assert(mimir.accruedFees(platform) == 0);
    }

    function test_onlyTheCreatorCancelsAndOnlyWhileOpen() public {
        uint256 id = _create(STAKE, "pool", 0);

        vm.prank(alice);
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(MimirV3.cancelClaim.selector, id));
        assert(!stranger);

        uint256 before = creator.balance;
        vm.prank(creator);
        mimir.cancelClaim(id);
        assert(creator.balance - before == _net(STAKE));

        uint256 id2 = _create(STAKE, "pool", 0);
        assert(_challenge(alice, id2, STAKE));
        vm.prank(creator);
        (bool active,) = address(mimir).call(abi.encodeWithSelector(MimirV3.cancelClaim.selector, id2));
        assert(!active);
    }

    function test_challengesCloseBeforeTheDeadline() public {
        uint256 id = _create(STAKE, "pool", 0);
        vm.warp(block.timestamp + GAP - mimir.CHALLENGE_LOCK_SECONDS() + 1);
        assert(!_challenge(alice, id, STAKE));
    }

    // ── Odds paths ──────────────────────────────────────────────────────────

    function test_fixedOddsReservesCreatorLiquidity() public {
        // 2x fixed on net stakes: each challenger's profit equals their net stake,
        // reserved from the creator's net 9.95.
        uint256 id = _create(STAKE, "fixed", 20_000);
        assert(_challenge(alice, id, 6 * ONE)); // reserves 5.97
        assert(!_challenge(bob, id, 6 * ONE)); // only 3.98 of creator liquidity left
        assert(_challenge(bob, id, 4 * ONE)); // net 3.98: exactly what is left

        uint256 aliceBefore = alice.balance;
        uint256 creatorBefore = creator.balance;
        _resolve(id, mimir.SIDE_CHALLENGERS());

        // Alice: twice her net stake, no fee on winnings.
        assert(alice.balance - aliceBefore == 2 * _net(6 * ONE));
        // Every unit of creator liquidity was committed, so nothing comes back.
        assert(creator.balance == creatorBefore);
    }

    function test_fixedOddsReturnsUnusedLiquidityToTheCreator() public {
        uint256 id = _create(STAKE, "fixed", 20_000);
        assert(_challenge(alice, id, 4 * ONE));

        uint256 creatorBefore = creator.balance;
        _resolve(id, mimir.SIDE_CHALLENGERS());
        // Net 9.95 staked, Alice's net 3.98 paid out as profit, the rest back at cost.
        assert(creator.balance - creatorBefore == _net(STAKE) - _net(4 * ONE));
    }

    function test_poolSplitsTheCreatorStakeProportionally() public {
        uint256 id = _create(20 * ONE, "pool", 0);
        assert(_challenge(alice, id, 10 * ONE));
        assert(_challenge(bob, id, 30 * ONE));

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        _resolve(id, mimir.SIDE_CHALLENGERS());

        // Alice owns 1/4 of the challenger side, Bob 3/4 of the creator's net 19.9.
        assert(alice.balance - aliceBefore == _net(10 * ONE) + _net(20 * ONE) / 4);
        assert(bob.balance - bobBefore == _net(30 * ONE) + (_net(20 * ONE) * 3) / 4);
        // All that remains is fees owed.
        assert(address(mimir).balance == mimir.lifetimeFeesAccrued());
    }
}
