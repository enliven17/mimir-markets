// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3Erc20, IMimirFees, IUsdc} from "../MimirV3Erc20.sol";
import {MimirFees} from "../MimirFees.sol";
import {FlatFees} from "./FlatFees.sol";
import {MockUsdc} from "./MockUsdc.sol";

/**
 * MimirV3Erc20 (Base: USDC as an ERC-20, 6 decimals). The cases that matter
 * for the port, mirrored from the native suites (MimirV3*.t.sol): the stake is
 * pulled with transferFrom, the fee math at 6 decimals, settlement and the
 * dispute bond in USDC, the refund paths, pause, the escape hatch, and a
 * blacklisted recipient that must not block anyone else's payout.
 * Dependency-free, absolute timestamps (via-IR can cache block.timestamp).
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

contract MimirV3Erc20Test {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3Erc20 mimir;
    MockUsdc usdc;
    MimirFees fees;

    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address referrer = address(0xA6E7);
    address creator = address(0xC7ea704);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address cold = address(0xC01D);

    uint256 constant ONE = 1e6; // 1 USDC
    uint256 constant STAKE = 10 * ONE;
    uint256 constant T0 = 1_000_000;
    uint256 constant DEADLINE = T0 + 1 days;
    uint256 constant AFTER = DEADLINE + 1;
    uint256 constant WINDOW = 1 hours;

    uint8 constant CREATOR = 1;
    uint8 constant CHALLENGERS = 2;
    uint8 constant DRAW = 3;
    uint8 constant UNRESOLVABLE = 4;

    function setUp() public {
        vm.warp(T0);
        usdc = new MockUsdc();
        fees = new MimirFees(address(this), address(0x5161));
        _fund(creator);
        _fund(alice);
        _fund(bob);
        _use(_deploy(IMimirFees(address(new FlatFees(0))), 0, 2 * ONE));
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _deploy(IMimirFees f, uint256 window, uint256 minStake) internal returns (MimirV3Erc20) {
        return new MimirV3Erc20(address(this), address(this), oracle, platform, f, window, minStake, IUsdc(address(usdc)));
    }

    function _fund(address who) internal {
        usdc.mint(who, 1_000 * ONE);
    }

    /// Switch the suite to `m` and give it the usual unlimited approvals.
    function _use(MimirV3Erc20 m) internal {
        mimir = m;
        address[3] memory who = [creator, alice, bob];
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(who[i]);
            usdc.approve(address(m), type(uint256).max);
        }
    }

    function _create(address who, uint256 stake, address ref) internal returns (uint256 id) {
        vm.prank(who);
        id = mimir.createClaim(
            "Will it?", "yes", "no", "https://example.com", DEADLINE, stake,
            "custom", 0, "binary", "pool", 0, "", "resolve from the source", 0, false, "", ref
        );
    }

    function _createFixed(address who, uint256 stake, uint256 payoutBps) internal returns (uint256 id) {
        vm.prank(who);
        id = mimir.createClaim(
            "Will it?", "yes", "no", "https://example.com", DEADLINE, stake,
            "custom", 0, "binary", "fixed", payoutBps, "", "rule", 0, false, "", address(0)
        );
    }

    function _challenge(address who, uint256 id, uint256 stake, address ref) internal {
        vm.prank(who);
        mimir.challengeClaim(id, stake, "", ref);
    }

    function _private(string memory mode, uint256 slots, string memory legacyKey) internal returns (uint256 id) {
        vm.prank(creator);
        id = mimir.createClaim(
            "Private duel", "yes", "no", "u", DEADLINE, STAKE,
            "custom", 0, "binary", mode, 20_000, "", "", slots, true, legacyKey, address(0)
        );
    }

    function _invite(uint256 id, address who, bool allowed) internal {
        address[] memory accounts = new address[](1);
        accounts[0] = who;
        vm.prank(creator);
        mimir.setInvited(id, accounts, allowed);
    }

    function _denyChallenge(address who, uint256 id, uint256 stake, string memory legacyKey) internal {
        uint256 balance = _bal(who);
        vm.prank(who);
        (bool ok, bytes memory reason) = address(mimir).call(abi.encodeWithSelector(
            MimirV3Erc20.challengeClaim.selector, id, stake, legacyKey, address(0)
        ));
        assert(!ok && keccak256(reason) == keccak256(abi.encodeWithSelector(MimirV3Erc20.NotInvited.selector)));
        assert(_bal(who) == balance && !mimir.hasChallenged(id, who));
    }

    function _resolve(uint256 id, uint8 side) internal {
        vm.warp(AFTER);
        vm.prank(oracle);
        mimir.resolveClaimWithCutoff(id, side, "because", 90, bytes32(uint256(1)), 0);
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,,,,,,,, state,,,,,,,,) = mimir.getClaim(id);
    }

    function _creatorStake(uint256 id) internal view returns (uint256 s) {
        (,,,,, s,,,,,,,,,,,,) = mimir.getClaim(id);
    }

    function _bal(address a) internal view returns (uint256) {
        return usdc.balanceOf(a);
    }

    /// The contract must always hold at least every parked payout and unclaimed fee.
    function _solvent() internal view {
        (,, uint256 outstanding) = mimir.getFeeStats();
        (,, uint256 held) = mimir.getPlatformStats();
        assert(held == _bal(address(mimir)));
        assert(held >= outstanding);
    }

    // ── Constants and constructor ───────────────────────────────────────────

    function test_constantsAreSixDecimals() public view {
        assert(mimir.MIN_STAKE_FLOOR() == 1e4);
        assert(mimir.MIN_STAKE_CEILING() == 100e6);
        assert(mimir.DISPUTE_BOND() == 2e6);
        assert(mimir.MIN_STAKE() == 2e6);
        assert(address(mimir.usdc()) == address(usdc));
    }

    function test_runtimeFitsBaseContractSizeLimit() public view {
        assert(address(mimir).code.length <= 24_576);
    }

    function test_constructorRefusesAMinimumOutOfRangeAndATokenWithoutCode() public {
        IMimirFees f = IMimirFees(address(fees));
        (bool lo,) = address(this).call(abi.encodeWithSelector(this.deployExternal.selector, f, 0, 1e4 - 1, address(usdc)));
        (bool hi,) = address(this).call(abi.encodeWithSelector(this.deployExternal.selector, f, 0, 100e6 + 1, address(usdc)));
        (bool noCode,) = address(this).call(abi.encodeWithSelector(this.deployExternal.selector, f, 0, 1e4, address(0xdead)));
        assert(!lo && !hi && !noCode);
        // Both bounds are accepted.
        this.deployExternal(f, 0, 1e4, address(usdc));
        this.deployExternal(f, 0, 100e6, address(usdc));
    }

    function deployExternal(IMimirFees f, uint256 window, uint256 minStake, address token) external returns (address) {
        return address(new MimirV3Erc20(address(this), address(this), oracle, platform, f, window, minStake, IUsdc(token)));
    }

    // ── Entry: pulled with transferFrom ─────────────────────────────────────

    function test_createAndChallengePullTheStake() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, 3 * ONE, address(0));
        assert(_bal(address(mimir)) == 13 * ONE);
        assert(_bal(creator) == 990 * ONE && _bal(alice) == 997 * ONE);
        assert(_creatorStake(id) == STAKE);
        _solvent();
    }

    function test_noAllowanceNoPosition() public {
        address broke = address(0xB10C);
        usdc.mint(broke, 100 * ONE); // funds, but no approval
        vm.prank(broke);
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(
            MimirV3Erc20.createClaim.selector, "q", "yes", "no", "u", DEADLINE, STAKE,
            "custom", uint256(0), "binary", "pool", uint256(0), "", "", uint256(0), false, "", address(0)
        ));
        assert(!ok);
        assert(mimir.claimCount() == 0);
    }

    function test_nativeValueIsRefused() public {
        vm.deal(creator, 10 ether);
        vm.prank(creator);
        (bool withCall,) = address(mimir).call{value: 1}(abi.encodeWithSelector(
            MimirV3Erc20.createClaim.selector, "q", "yes", "no", "u", DEADLINE, STAKE,
            "custom", uint256(0), "binary", "pool", uint256(0), "", "", uint256(0), false, "", address(0)
        ));
        vm.prank(creator);
        (bool plain,) = address(mimir).call{value: 1}("");
        assert(!withCall && !plain);
    }

    function test_aFeeOnTransferTokenIsRefused() public {
        usdc.setSkim(1);
        vm.prank(creator);
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(
            MimirV3Erc20.createClaim.selector, "q", "yes", "no", "u", DEADLINE, STAKE,
            "custom", uint256(0), "binary", "pool", uint256(0), "", "", uint256(0), false, "", address(0)
        ));
        assert(!ok);
    }

    function test_aTokenReturningFalseOnPullIsRefused() public {
        usdc.setReturnFalse(true);
        vm.prank(creator);
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(
            MimirV3Erc20.createClaim.selector, "q", "yes", "no", "u", DEADLINE, STAKE,
            "custom", uint256(0), "binary", "pool", uint256(0), "", "", uint256(0), false, "", address(0)
        ));
        assert(!ok);
    }

    function test_minimumStakeAppliesToTheGrossAmount() public {
        vm.prank(creator);
        (bool small,) = address(mimir).call(abi.encodeWithSelector(
            MimirV3Erc20.createClaim.selector, "q", "yes", "no", "u", DEADLINE, 2 * ONE - 1,
            "custom", uint256(0), "binary", "pool", uint256(0), "", "", uint256(0), false, "", address(0)
        ));
        assert(!small);
        uint256 id = _create(creator, 2 * ONE, address(0));
        vm.prank(alice);
        (bool smallCh,) = address(mimir).call(
            abi.encodeWithSelector(MimirV3Erc20.challengeClaim.selector, id, 2 * ONE - 1, "", address(0))
        );
        assert(!smallCh);
    }

    // ── Fees at 6 decimals ──────────────────────────────────────────────────

    function test_entryFeeAtTheOneCentFloorIsFiftyUnits() public {
        _use(_deploy(IMimirFees(address(fees)), 0, 1e4));
        uint256 id = _create(creator, 1e4, address(0)); // 0.01 USDC, 0.5% = 50 units
        _challenge(alice, id, 1e4, address(0));
        assert(_creatorStake(id) == 1e4 - 50);
        assert(mimir.accruedFees(platform) == 100);
        _resolve(id, CREATOR);
        assert(_bal(creator) == 1_000 * ONE - 1e4 + 2 * (1e4 - 50));
        assert(_bal(address(mimir)) == 100);
        vm.prank(platform);
        mimir.claimFees();
        assert(_bal(platform) == 100 && _bal(address(mimir)) == 0);
    }

    function test_entryFeeAndCopyFeeOnProfit() public {
        _use(_deploy(IMimirFees(address(fees)), 0, 2 * ONE));
        uint256 id = _create(creator, STAKE, referrer);
        _challenge(alice, id, STAKE, address(0));
        uint256 net = STAKE - (STAKE * 50) / 10_000; // 9.95 USDC
        assert(mimir.accruedFees(platform) == 2 * (STAKE - net));

        uint256 before = _bal(creator);
        _resolve(id, CREATOR);
        // Profit = alice's net stake; 1% to the referrer, 1% to the platform.
        uint256 cut = (net * 100) / 10_000;
        assert(_bal(creator) - before == 2 * net - 2 * cut);
        assert(mimir.accruedFees(referrer) == cut);
        assert(mimir.accruedFees(platform) == 2 * (STAKE - net) + cut);
        _solvent();

        vm.prank(referrer);
        mimir.claimFeesTo(cold);
        assert(_bal(cold) == cut);
    }

    function test_aTinyCopyProfitRoundsTheCopyFeeToZero() public {
        _use(_deploy(IMimirFees(address(new FlatFees(0))), 0, 1e4));
        // Fixed odds 1.005x: a 0.01 USDC copy-trade challenge profits 50 units; 1% of that rounds to 0.
        uint256 id = _createFixed(creator, 1e4, 10_050);
        _challenge(alice, id, 1e4, referrer);
        // Below the minimum is refused outright.
        vm.prank(bob);
        (bool dust,) = address(mimir).call(
            abi.encodeWithSelector(MimirV3Erc20.challengeClaim.selector, id, uint256(1e4 - 1), "", address(0))
        );
        assert(!dust);
        _resolve(id, CHALLENGERS);
        assert(_bal(alice) == 1_000 * ONE + 50);
        assert(mimir.accruedFees(referrer) == 0 && mimir.accruedFees(platform) == 0);
        assert(_bal(creator) == 1_000 * ONE - 50);
    }

    // ── Settlement ──────────────────────────────────────────────────────────

    function test_challengersWinThePoolSplitInUsdc() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, 3 * ONE, address(0));
        _challenge(bob, id, 7 * ONE, address(0));
        _resolve(id, CHALLENGERS);
        // Pool odds: each takes stake + pro-rata share of the creator's 10.
        assert(_bal(alice) == 997 * ONE + 3 * ONE + 3 * ONE);
        assert(_bal(bob) == 993 * ONE + 7 * ONE + 7 * ONE);
        assert(_bal(creator) == 990 * ONE);
        assert(_bal(address(mimir)) == 0);
    }

    function test_fixedOddsReturnUnusedLiquidity() public {
        uint256 id = _createFixed(creator, STAKE, 20_000); // 2x
        _challenge(alice, id, 4 * ONE, address(0));
        _resolve(id, CHALLENGERS);
        assert(_bal(alice) == 996 * ONE + 8 * ONE);
        assert(_bal(creator) == 990 * ONE + 6 * ONE);
        assert(_bal(address(mimir)) == 0);
    }

    function test_aDrawRefundsEveryone() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, 5 * ONE, address(0));
        _resolve(id, DRAW);
        assert(_bal(creator) == 1_000 * ONE && _bal(alice) == 1_000 * ONE);
    }

    function test_cancelRefundsAnOpenClaim() public {
        uint256 id = _create(creator, STAKE, address(0));
        vm.prank(creator);
        mimir.cancelClaim(id);
        assert(_bal(creator) == 1_000 * ONE && _state(id) == mimir.ST_CANCELLED());
    }

    // ── One bad recipient never blocks a settlement ─────────────────────────

    function test_aBlacklistedWinnerIsParkedAndOthersArePaid() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, 4 * ONE, address(0));
        _challenge(bob, id, 6 * ONE, address(0));
        usdc.blacklist(alice, true);

        _resolve(id, CHALLENGERS);
        assert(_state(id) == mimir.ST_RESOLVED());
        assert(_bal(bob) == 994 * ONE + 12 * ONE); // paid in the same transaction
        assert(mimir.pendingWithdrawals(alice) == 8 * ONE);
        assert(_bal(alice) == 996 * ONE);
        _solvent();

        // Still blacklisted: a pull to her own address fails, to another address works.
        vm.prank(alice);
        (bool own,) = address(mimir).call(abi.encodeWithSelector(MimirV3Erc20.withdraw.selector));
        assert(!own);
        vm.prank(alice);
        mimir.withdrawTo(cold);
        assert(_bal(cold) == 8 * ONE && mimir.pendingWithdrawals(alice) == 0);
        assert(_bal(address(mimir)) == 0);
    }

    function test_aTokenReturningFalseOnPushParksThePayout() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, STAKE, address(0));
        usdc.setReturnFalse(true);
        _resolve(id, CREATOR);
        assert(mimir.pendingWithdrawals(creator) == 2 * STAKE);
        usdc.setReturnFalse(false);
        vm.prank(creator);
        mimir.withdraw();
        assert(_bal(creator) == 1_010 * ONE);
    }

    function test_aTokenWithoutReturnValueWorksEndToEnd() public {
        usdc.setNoBool(true);
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, STAKE, address(0));
        _resolve(id, CHALLENGERS);
        assert(_bal(alice) == 1_010 * ONE && _bal(creator) == 990 * ONE);
        assert(mimir.pendingWithdrawals(alice) == 0);
    }

    // ── Disputes and the bond ───────────────────────────────────────────────

    function _disputed() internal returns (uint256 id) {
        _use(_deploy(IMimirFees(address(new FlatFees(0))), WINDOW, 2 * ONE));
        id = _create(creator, STAKE, address(0));
        _challenge(alice, id, STAKE, address(0));
        _resolve(id, CREATOR);
        assert(_state(id) == mimir.ST_PROPOSED());
        vm.prank(alice);
        mimir.disputeResolution(id);
        assert(_state(id) == mimir.ST_DISPUTED());
        assert(_bal(alice) == 990 * ONE - 2 * ONE); // the bond was pulled
    }

    function test_aRightDisputeReturnsTheBond() public {
        uint256 id = _disputed();
        mimir.resolveDisputeWithCutoff(id, CHALLENGERS, "arbiter", 80, bytes32(uint256(2)), 0);
        assert(_bal(alice) == 1_010 * ONE); // stake + win + bond
        assert(mimir.accruedFees(platform) == 0);
    }

    function test_aWrongDisputeForfeitsTheBond() public {
        uint256 id = _disputed();
        mimir.resolveDisputeWithCutoff(id, CREATOR, "upheld", 80, bytes32(uint256(1)), 0);
        assert(mimir.accruedFees(platform) == 2 * ONE);
        assert(_bal(creator) == 1_010 * ONE);
        _solvent();
    }

    function test_aBlacklistedDisputerGetsTheBondParked() public {
        uint256 id = _disputed();
        usdc.blacklist(alice, true);
        mimir.resolveDisputeWithCutoff(id, CHALLENGERS, "arbiter", 80, bytes32(uint256(2)), 0);
        assert(mimir.pendingWithdrawals(alice) == 2 * STAKE + 2 * ONE);
        _solvent();
    }

    function test_onlyParticipantsDisputeAndNeedTheBond() public {
        _use(_deploy(IMimirFees(address(new FlatFees(0))), WINDOW, 2 * ONE));
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, STAKE, address(0));
        _resolve(id, CREATOR);
        vm.prank(bob); // not a participant
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(MimirV3Erc20.disputeResolution.selector, id));
        vm.prank(alice);
        usdc.approve(address(mimir), 2 * ONE - 1);
        vm.prank(alice);
        (bool short,) = address(mimir).call(abi.encodeWithSelector(MimirV3Erc20.disputeResolution.selector, id));
        assert(!stranger && !short);
        vm.warp(AFTER + WINDOW);
        mimir.finalizeResolution(id);
        assert(_bal(creator) == 1_010 * ONE);
    }

    // ── Escape hatch and pause ──────────────────────────────────────────────

    function test_anUnresolvedClaimIsRefundedAfterTheGrace() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, 4 * ONE, address(0));
        vm.warp(DEADLINE + 7 days - 1);
        (bool early,) = address(mimir).call(abi.encodeWithSelector(MimirV3Erc20.refundExpired.selector, id));
        assert(!early);
        vm.warp(DEADLINE + 7 days);
        vm.prank(bob);
        mimir.refundExpired(id);
        assert(_bal(creator) == 1_000 * ONE && _bal(alice) == 1_000 * ONE);
        // The oracle can no longer rule.
        vm.prank(oracle);
        (bool late,) = address(mimir).call(
            abi.encodeWithSelector(MimirV3Erc20.resolveClaimWithCutoff.selector, id, CREATOR, "x", uint8(1), bytes32(0), uint256(0))
        );
        assert(!late);
    }

    function test_privateClaimRejectsCopiedCreationKey() public {
        uint256 id = _private("fixed", 1, "visible-in-calldata");
        _denyChallenge(bob, id, STAKE, "visible-in-calldata");
        (,,,,,,, uint256 reserved,,,,,,,,,,) = mimir.getClaim(id);
        assert(reserved == 0);
        _invite(id, alice, true);
        _challenge(alice, id, STAKE, address(0));
        (,,,,,,, reserved,,,,,,,,,,) = mimir.getClaim(id);
        assert(reserved == STAKE); // only the invited wallet can reserve liquidity
    }

    function test_privatePoolRoomAndSlotCannotBeTakenWithACopiedKey() public {
        uint256 id = _private("pool", 1, "visible-in-calldata");
        _invite(id, alice, true);
        _denyChallenge(bob, id, 5 * STAKE, "visible-in-calldata");
        _challenge(alice, id, 5 * STAKE, address(0));
        (address joined, uint256 stake) = mimir.getChallenger(id, 0);
        assert(joined == alice && stake == 5 * STAKE);
    }

    function test_aCopiedInvitedChallengeDoesNotAuthorizeAnotherWallet() public {
        uint256 id = _private("pool", 3, "creation-key");
        _invite(id, alice, true);
        bytes memory data = abi.encodeWithSelector(
            MimirV3Erc20.challengeClaim.selector, id, 2 * ONE, "first-challenger-calldata", address(0)
        );
        vm.prank(alice);
        (bool joined,) = address(mimir).call(data);
        assert(joined);
        // Replay the exact input after the first invited participant has joined.
        vm.prank(bob);
        (bool replay, bytes memory reason) = address(mimir).call(data);
        assert(!replay && keccak256(reason) == keccak256(abi.encodeWithSelector(MimirV3Erc20.NotInvited.selector)));
        assert(_bal(bob) == 1_000 * ONE && !mimir.hasChallenged(id, bob));
    }

    function test_privateClaimsNeedWalletGrantsEvenWithAnEmptyLegacyKey() public {
        uint256 id = _private("pool", 3, "");
        _denyChallenge(bob, id, STAKE, "");
        _invite(id, alice, true);
        _challenge(alice, id, STAKE, address(0));
        assert(mimir.hasChallenged(id, alice));
    }

    function test_onlyTheCreatorCanGrantOrRevokeInvites() public {
        uint256 id = _private("pool", 3, "");
        address[] memory accounts = new address[](1);
        accounts[0] = bob;
        vm.prank(bob);
        (bool stranger,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.setInvited, (id, accounts, true)));
        // Even the protocol owner cannot choose a private claim's participants.
        (bool admin,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.setInvited, (id, accounts, true)));
        assert(!stranger && !admin && !mimir.invited(id, bob));
        _invite(id, alice, true);
        vm.prank(bob);
        accounts[0] = alice;
        (bool revoked,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.setInvited, (id, accounts, false)));
        assert(!revoked && mimir.invited(id, alice));
    }

    function test_revocationBlocksEntryWithoutChangingFundedPositions() public {
        uint256 id = _private("pool", 3, "");
        _invite(id, alice, true);
        _invite(id, bob, true);
        _challenge(alice, id, STAKE, address(0));
        _invite(id, alice, false);
        _invite(id, bob, false);
        _denyChallenge(bob, id, STAKE, "");
        _resolve(id, CHALLENGERS);
        assert(_bal(alice) == 1_010 * ONE); // removing access cannot confiscate a position
    }

    function test_invitesAreScopedToTheClaimAndRematchesStartClosed() public {
        uint256 parent = _private("pool", 3, "same-public-key");
        uint256 other = _private("pool", 3, "same-public-key");
        _invite(parent, alice, true);
        _denyChallenge(alice, other, STAKE, "same-public-key");
        vm.prank(creator);
        uint256 rematch = mimir.createRematch(parent, DEADLINE, STAKE, "same-public-key");
        assert(!mimir.invited(rematch, alice));
        (,,,,,, bool isPrivate,) = mimir.getClaimMarketConfig(rematch);
        assert(isPrivate);
        _denyChallenge(alice, rematch, STAKE, "same-public-key");
        _invite(rematch, bob, true);
        _challenge(bob, rematch, STAKE, address(0));
        assert(mimir.invited(parent, alice) && !mimir.invited(parent, bob));
    }

    function test_invalidInviteBatchesRevertAtomicallyAndClosedClaimsRejectChanges() public {
        uint256 id = _private("pool", 3, "");
        address[] memory accounts = new address[](2);
        accounts[0] = alice;
        accounts[1] = address(0);
        vm.prank(creator);
        (bool zero,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.setInvited, (id, accounts, true)));
        assert(!zero && !mimir.invited(id, alice));
        accounts[1] = creator;
        vm.prank(creator);
        (bool self,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.setInvited, (id, accounts, true)));
        accounts = new address[](101);
        for (uint256 i = 0; i < accounts.length; i++) accounts[i] = alice;
        vm.prank(creator);
        (bool oversized,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.setInvited, (id, accounts, true)));
        assert(!self && !oversized);
        vm.prank(creator);
        mimir.cancelClaim(id);
        accounts = new address[](1);
        accounts[0] = alice;
        vm.prank(creator);
        (bool closed,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.setInvited, (id, accounts, true)));
        uint256 publicId = _create(creator, STAKE, address(0));
        vm.prank(creator);
        (bool publicClaim,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.setInvited, (publicId, accounts, true)));
        assert(!closed && !publicClaim);
    }

    function testFuzz_uninvitedWalletCannotUsePublicCalldata(address outsider) public {
        if (outsider == address(0) || outsider == creator || outsider == alice) return;
        uint256 id = _private("pool", 3, "public-calldata");
        _invite(id, alice, true);
        _denyChallenge(outsider, id, STAKE, "public-calldata");
    }

    function testFuzz_settlementConservesUsdcWithEntryAndCopyFees(uint64 c, uint64 a, uint8 verdict) public {
        _use(_deploy(IMimirFees(address(fees)), 0, 1e4));
        uint256 id = _create(creator, 2 * ONE + uint256(c) % (98 * ONE), referrer);
        _challenge(alice, id, 2 * ONE + uint256(a) % (8 * ONE), referrer);
        _resolve(id, uint8(1 + uint256(verdict) % 4));
        assert(_bal(creator) + _bal(alice) + _bal(bob) + _bal(address(mimir)) == 3_000 * ONE);
        assert(_bal(address(mimir)) == mimir.accruedFees(platform) + mimir.accruedFees(referrer));
    }

    function test_pausedUndisputedProposalCanBeRefundedAfterGrace() public {
        _use(_deploy(IMimirFees(address(new FlatFees(0))), WINDOW, 2 * ONE));
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, STAKE, address(0));
        _resolve(id, CREATOR);
        mimir.setPaused(true);
        vm.warp(AFTER + 7 days);
        vm.prank(bob);
        mimir.refundExpired(id);
        assert(_state(id) == mimir.ST_RESOLVED());
        assert(_bal(creator) == 1_000 * ONE && _bal(alice) == 1_000 * ONE);
    }

    function test_pausedProposalWaitsAFullGraceFromALateProposal() public {
        _use(_deploy(IMimirFees(address(new FlatFees(0))), WINDOW, 2 * ONE));
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, STAKE, address(0));
        uint256 proposedAt = DEADLINE + 6 days;
        vm.warp(proposedAt);
        vm.prank(oracle);
        mimir.resolveClaimWithCutoff(id, CREATOR, "late proposal", 90, bytes32(0), 0);
        mimir.setPaused(true);
        vm.warp(proposedAt + 7 days - 1);
        (bool early,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.refundExpired, (id)));
        assert(!early);
        vm.warp(proposedAt + 7 days);
        mimir.refundExpired(id);
        mimir.setPaused(false);
        (bool doublePay,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.finalizeResolution, (id)));
        assert(!doublePay && _bal(creator) == 1_000 * ONE && _bal(alice) == 1_000 * ONE);
    }

    function test_unpausedProposalCannotBeConvertedToARefund() public {
        _use(_deploy(IMimirFees(address(new FlatFees(0))), WINDOW, 2 * ONE));
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, STAKE, address(0));
        _resolve(id, CREATOR);
        vm.warp(AFTER + 7 days);
        (bool refund,) = address(mimir).call(abi.encodeCall(MimirV3Erc20.refundExpired, (id)));
        assert(!refund);
        mimir.finalizeResolution(id);
        assert(_bal(creator) == 1_010 * ONE && _bal(alice) == 990 * ONE);
    }

    function test_unruledDisputeHonoursProposalAndForfeitsBond() public {
        uint256 id = _disputed();
        vm.warp(AFTER + 7 days);
        mimir.refundExpired(id);
        assert(_bal(creator) == 1_010 * ONE && _bal(alice) == 988 * ONE);
        assert(mimir.accruedFees(platform) == 2 * ONE);
    }

    function test_pausedDisputeRefundsBothStakesAndTheBond() public {
        uint256 id = _disputed();
        mimir.setPaused(true);
        vm.warp(AFTER + 7 days);
        mimir.refundExpired(id);
        assert(_bal(creator) == 1_000 * ONE && _bal(alice) == 1_000 * ONE);
        assert(mimir.accruedFees(platform) == 0);
    }

    function test_vetoedProposalRefundsIfArbiterDoesNotRule() public {
        _use(_deploy(IMimirFees(address(new FlatFees(0))), WINDOW, 2 * ONE));
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, STAKE, address(0));
        _resolve(id, CREATOR);
        mimir.vetoProposal(id);
        vm.warp(AFTER + 7 days);
        mimir.refundExpired(id);
        assert(_bal(creator) == 1_000 * ONE && _bal(alice) == 1_000 * ONE);
    }

    function test_pauseStopsPositionsAndSettlementButNotRefunds() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(alice, id, STAKE, address(0));
        uint256 open = _create(bob, STAKE, address(0));
        mimir.setPaused(true);

        vm.prank(bob);
        (bool create,) = address(mimir).call(abi.encodeWithSelector(
            MimirV3Erc20.createClaim.selector, "q", "yes", "no", "u", DEADLINE, STAKE,
            "custom", uint256(0), "binary", "pool", uint256(0), "", "", uint256(0), false, "", address(0)
        ));
        vm.warp(AFTER);
        vm.prank(oracle);
        (bool settle,) = address(mimir).call(
            abi.encodeWithSelector(MimirV3Erc20.resolveClaimWithCutoff.selector, id, CREATOR, "x", uint8(1), bytes32(0), uint256(0))
        );
        assert(!create && !settle);

        vm.prank(bob);
        mimir.cancelClaim(open); // refunds stay open
        assert(_bal(bob) == 1_000 * ONE);
        vm.warp(DEADLINE + 7 days);
        mimir.refundExpired(id);
        assert(_bal(creator) == 1_000 * ONE && _bal(alice) == 1_000 * ONE);
    }
}
