// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3, IMimirFees} from "../MimirV3.sol";
import {MimirFees} from "../MimirFees.sol";

/**
 * Tests for the fee-bearing escrow: an entry fee on every position, no fee on
 * winnings except copy trades (1% of profit to the referrer, 1% to the platform).
 *
 * Deliberately dependency-free: only the cheatcodes actually needed are
 * declared, so the suite runs without vendoring forge-std into the repo.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

/** A recipient whose receive() reverts, to prove one bad address cannot freeze a settlement. */
contract RejectsPayment {
    receive() external payable {
        revert("no thanks");
    }

    function challenge(MimirV3 m, uint256 id, uint256 stake) external payable {
        m.challengeClaim{value: stake}(id, stake, "", address(0));
    }

    function pull(MimirV3 m) external {
        m.withdraw();
    }
}

contract MimirV3Test {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3 mimir;
    MimirFees fees;

    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address referrer = address(0xA6E7);
    address creator = address(0xC7ea704);
    address challenger = address(0xC4a11e);

    uint256 constant ONE = 1e18;
    uint256 constant STAKE = 10 * ONE;
    uint256 constant DEADLINE_GAP = 1 days;

    function setUp() public {
        vm.warp(1_000_000);
        fees = new MimirFees(address(0x5161));
        mimir = new MimirV3(oracle, platform, IMimirFees(address(fees)), 0, 2e18);
        vm.deal(creator, 1_000 * ONE);
        vm.deal(challenger, 1_000 * ONE);
        vm.deal(address(this), 1_000 * ONE);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /// The base entry fee (0.5%) and what is staked after it.
    function _fee(uint256 amount) internal pure returns (uint256) {
        return (amount * 50) / 10_000;
    }

    function _net(uint256 amount) internal pure returns (uint256) {
        return amount - _fee(amount);
    }

    function _create(address who, uint256 stake, address ref) internal returns (uint256 id) {
        vm.prank(who);
        id = mimir.createClaim{value: stake}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + DEADLINE_GAP, stake,
            "custom", 0, "binary", "pool", 0, "", "resolve from the source", 0, false, "", ref
        );
    }

    function _challenge(address who, uint256 id, uint256 stake, address ref) internal {
        vm.prank(who);
        mimir.challengeClaim{value: stake}(id, stake, "", ref);
    }

    function _settle(uint256 id, uint8 side) internal {
        vm.warp(block.timestamp + DEADLINE_GAP + 1);
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "because", 90, bytes32(uint256(1)));
    }

    // ── Entry fee ───────────────────────────────────────────────────────────

    function test_everyPositionPaysTheEntryFee() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));

        (,,,,, uint256 creatorStake, uint256 challengers,,,,,,,,,,,) = mimir.getClaim(id);
        assert(creatorStake == _net(STAKE));
        assert(challengers == _net(STAKE));
        assert(mimir.accruedFees(platform) == 2 * _fee(STAKE));
        (uint256 entryFees,) = mimir.getClaimFees(id);
        assert(entryFees == 2 * _fee(STAKE));
    }

    function test_theValueMustMatchTheStake() public {
        vm.prank(creator);
        (bool ok,) = address(mimir).call{value: STAKE - 1}(
            abi.encodeWithSelector(
                MimirV3.createClaim.selector, "q", "yes", "no", "u", block.timestamp + DEADLINE_GAP, STAKE,
                "custom", uint256(0), "binary", "pool", uint256(0), "", "", uint256(0), false, "", address(0)
            )
        );
        assert(!ok);
    }

    function test_theMinimumAppliesToWhatIsSent() public {
        // 2 USDC sent is enough even though 1.99 is staked after the fee.
        uint256 id = _create(creator, 2 * ONE, address(0));
        (,,,,, uint256 creatorStake,,,,,,,,,,,,) = mimir.getClaim(id);
        assert(creatorStake == _net(2 * ONE));
    }

    // ── Winnings: no fee, except copy trades ────────────────────────────────

    function test_aWinnerTakesBothNetStakesWithNoFee() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));

        uint256 before = creator.balance;
        _settle(id, mimir.SIDE_CREATOR());
        assert(creator.balance - before == 2 * _net(STAKE));
        assert(mimir.accruedFees(platform) == 2 * _fee(STAKE));
    }

    function test_aCopyTradePaysOnePercentEachOnProfit() public {
        uint256 id = _create(creator, STAKE, referrer);
        _challenge(challenger, id, STAKE, address(0));

        uint256 before = creator.balance;
        _settle(id, mimir.SIDE_CREATOR());

        uint256 profit = _net(STAKE);
        uint256 copyFees = (profit * 100) / 10_000 + (profit * 100) / 10_000;
        assert(creator.balance - before == 2 * _net(STAKE) - copyFees);
        assert(mimir.accruedFees(referrer) == (profit * 100) / 10_000);
        assert(mimir.accruedFees(platform) == 2 * _fee(STAKE) + (profit * 100) / 10_000);
    }

    function test_aLosingCopyTradePaysNoCopyFee() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, referrer);
        _settle(id, mimir.SIDE_CREATOR());
        assert(mimir.accruedFees(referrer) == 0);
    }

    function test_aRefundPaysNoCopyFee() public {
        uint256 id = _create(creator, STAKE, referrer);
        _challenge(challenger, id, STAKE, referrer);
        _settle(id, mimir.SIDE_DRAW());
        assert(mimir.accruedFees(referrer) == 0);
        assert(mimir.accruedFees(platform) == 2 * _fee(STAKE));
    }

    function test_nobodyPaysThemselves() public {
        // The winner is its own referrer: no copy fee at all.
        uint256 id = _create(creator, STAKE, creator);
        _challenge(challenger, id, STAKE, address(0));
        uint256 before = creator.balance;
        _settle(id, mimir.SIDE_CREATOR());
        assert(creator.balance - before == 2 * _net(STAKE));
        assert(mimir.accruedFees(creator) == 0);
    }

    function test_aChallengersReferrerIsPerPosition() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, referrer);
        _settle(id, mimir.SIDE_CHALLENGERS());
        assert(mimir.accruedFees(referrer) == (_net(STAKE) * 100) / 10_000);
    }

    function test_aWinnerNeverReceivesLessThanTheirNetStake() public {
        uint256 id = _create(creator, STAKE, referrer);
        _challenge(challenger, id, 2 * ONE, address(0));
        uint256 before = creator.balance;
        _settle(id, mimir.SIDE_CREATOR());
        assert(creator.balance - before >= _net(STAKE));
    }

    // ── Refunds keep the entry fee ──────────────────────────────────────────

    function test_aDrawRefundsTheNetStakes() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));
        uint256 creatorBefore = creator.balance;
        uint256 challengerBefore = challenger.balance;
        _settle(id, mimir.SIDE_DRAW());
        assert(creator.balance - creatorBefore == _net(STAKE));
        assert(challenger.balance - challengerBefore == _net(STAKE));
        assert(mimir.lifetimeFeesAccrued() == 2 * _fee(STAKE));
    }

    function test_unresolvableRefundsTheNetStakes() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));
        uint256 challengerBefore = challenger.balance;
        _settle(id, mimir.SIDE_UNRESOLVABLE());
        assert(challenger.balance - challengerBefore == _net(STAKE));
    }

    function test_aCancelRefundsTheNetStake() public {
        uint256 id = _create(creator, STAKE, address(0));
        uint256 before = creator.balance;
        vm.prank(creator);
        mimir.cancelClaim(id);
        assert(creator.balance - before == _net(STAKE));
        assert(mimir.accruedFees(platform) == _fee(STAKE));
    }

    function test_anExpiredRefundKeepsTheEntryFee() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));
        vm.warp(block.timestamp + DEADLINE_GAP + mimir.RESOLUTION_GRACE_SECONDS());
        uint256 before = challenger.balance;
        mimir.refundExpired(id);
        assert(challenger.balance - before == _net(STAKE));
        assert(address(mimir).balance == mimir.lifetimeFeesAccrued());
    }

    function test_feesAreConserved() public {
        uint256 id = _create(creator, STAKE, referrer);
        _challenge(challenger, id, STAKE, address(0));
        _settle(id, mimir.SIDE_CREATOR());
        // Everything not paid out is exactly the fees still owed.
        assert(address(mimir).balance == mimir.lifetimeFeesAccrued());
    }

    // ── Pull payments ───────────────────────────────────────────────────────

    function test_feesArePulledNotPushed() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));
        _settle(id, mimir.SIDE_CREATOR());

        uint256 owed = mimir.accruedFees(platform);
        assert(owed > 0);
        uint256 before = platform.balance;
        vm.prank(platform);
        mimir.claimFees();
        assert(platform.balance - before == owed);
        assert(mimir.accruedFees(platform) == 0);
        assert(mimir.lifetimeFeesClaimed() == owed);
    }

    function test_aRejectingWinnerCannotFreezeSettlement() public {
        RejectsPayment bad = new RejectsPayment();
        vm.deal(address(bad), 100 * ONE);

        uint256 id = _create(creator, STAKE, address(0));
        bad.challenge{value: STAKE}(mimir, id, STAKE);
        _settle(id, mimir.SIDE_CHALLENGERS());

        uint256 parked = mimir.pendingWithdrawals(address(bad));
        assert(parked == 2 * _net(STAKE));
        (,,,,,,,,, uint8 state,,,,,,,,) = mimir.getClaim(id);
        assert(state == mimir.ST_RESOLVED());

        // A failed pull is atomic: the balance stays on the books.
        vm.prank(address(bad));
        (bool pulled,) = address(mimir).call(abi.encodeWithSignature("withdraw()"));
        assert(!pulled);
        assert(mimir.pendingWithdrawals(address(bad)) == parked);
    }

    // ── Fee recipient governance ────────────────────────────────────────────

    function test_aNewFeeRecipientIsTimelocked() public {
        mimir.queueFeeRecipient(referrer);
        (bool early,) = address(mimir).call(abi.encodeWithSignature("executeFeeRecipient()"));
        assert(!early);
        vm.warp(block.timestamp + mimir.FEE_TIMELOCK_SECONDS());
        (bool late,) = address(mimir).call(abi.encodeWithSignature("executeFeeRecipient()"));
        assert(late);
        assert(mimir.feeRecipient() == referrer);
    }

    function test_aQueuedFeeRecipientCanBeCancelled() public {
        mimir.queueFeeRecipient(referrer);
        mimir.cancelFeeRecipient();
        vm.warp(block.timestamp + 3 days);
        (bool ok,) = address(mimir).call(abi.encodeWithSignature("executeFeeRecipient()"));
        assert(!ok);
        assert(mimir.feeRecipient() == platform);
    }

    function test_onlyTheOwnerQueuesAFeeRecipient() public {
        vm.prank(creator);
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(MimirV3.queueFeeRecipient.selector, creator));
        assert(!ok);
    }

    // ── The invariant, fuzzed ───────────────────────────────────────────────

    /**
     * Any stakes, with or without a referrer: a winner never gets back less
     * than their net stake, and the escrow never pays out more than it took in.
     */
    function testFuzz_winnerNeverLosesPrincipal(uint96 rawCreatorStake, uint96 rawChallengerStake, bool withReferrer)
        public
    {
        uint256 creatorStake = 2 * ONE + (uint256(rawCreatorStake) % (500 * ONE));
        // Net challenger stakes are capped at 5x the creator's net stake; 4x gross always fits.
        uint256 challengerStake = 2 * ONE + (uint256(rawChallengerStake) % (creatorStake * 4 - 2 * ONE + 1));
        vm.deal(creator, creatorStake);
        vm.deal(challenger, challengerStake);

        uint256 id = _create(creator, creatorStake, withReferrer ? referrer : address(0));
        _challenge(challenger, id, challengerStake, address(0));

        uint256 escrow = creatorStake + challengerStake;
        uint256 before = creator.balance;
        _settle(id, mimir.SIDE_CREATOR());
        uint256 received = creator.balance - before;

        assert(received >= _net(creatorStake));
        assert(received + mimir.lifetimeFeesAccrued() <= escrow);
        assert(address(mimir).balance == mimir.lifetimeFeesAccrued());
    }

    // ── Authorization ───────────────────────────────────────────────────────

    function test_onlyTheOracleSettles() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));
        vm.warp(block.timestamp + DEADLINE_GAP + 1);
        (bool ok,) = address(mimir).call(
            abi.encodeWithSignature("resolveClaim(uint256,uint8,string,uint8,bytes32)", id, uint8(1), "x", uint8(90), bytes32(0))
        );
        assert(!ok);
    }

    receive() external payable {}
}
