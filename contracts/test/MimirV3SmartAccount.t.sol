// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3, IMimirFees} from "../MimirV3.sol";
import {FlatFees} from "./FlatFees.sol";

/**
 * On Arc every user is an ERC-4337 smart account (Circle Modular Wallet), so
 * msg.sender is a contract and payouts are pushed to a contract. These tests
 * play the whole market with such accounts.
 *
 * Absolute timestamps throughout: under via-IR, block.timestamp read twice in
 * one test function can come back cached across vm.warp.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

/// The shape that matters here: calls arrive from the account, value is
/// received by a plain receive(). `execute` stands in for the EntryPoint.
contract MiniAccount {
    address public immutable owner;
    bool public refuse;

    constructor(address _owner) {
        owner = _owner;
    }

    receive() external payable {
        // Light, like a modular account's receive: one storage read.
        if (refuse) revert("account paused");
    }

    function setRefuse(bool r) external {
        require(msg.sender == owner, "not owner");
        refuse = r;
    }

    function execute(address target, uint256 value, bytes calldata data) external returns (bytes memory ret) {
        require(msg.sender == owner, "not owner");
        bool ok;
        (ok, ret) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

contract MimirV3SmartAccountTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3 mimir;
    MiniAccount maker;
    MiniAccount taker;

    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address keeper = address(0xB0B);

    uint256 constant ONE = 1e18;
    uint256 constant STAKE = 2 * ONE;
    uint256 constant FEE_BPS = 50; // the 0.5% base entry fee
    uint256 constant WINDOW = 60;

    uint256 constant T0 = 1_000_000;
    uint256 constant DEADLINE = T0 + 2 days + 1 hours;

    function setUp() public {
        vm.warp(T0);
        mimir = new MimirV3(oracle, platform, IMimirFees(address(new FlatFees(uint16(FEE_BPS)))), WINDOW, 2e18);
        vm.warp(T0 + 2 days);

        maker = new MiniAccount(address(this));
        taker = new MiniAccount(address(this));
        vm.deal(address(maker), 100 * ONE);
        vm.deal(address(taker), 100 * ONE);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _create() internal returns (uint256 id) {
        bytes memory ret = maker.execute(address(mimir), STAKE, abi.encodeWithSelector(
            MimirV3.createClaim.selector,
            "Will it?", "yes", "no", "https://example.com", DEADLINE, STAKE,
            "custom", uint256(0), "binary", "pool", uint256(0), "", "rule", uint256(0), false, "", address(0)
        ));
        id = abi.decode(ret, (uint256));
    }

    function _challenge(uint256 id) internal {
        taker.execute(
            address(mimir), STAKE,
            abi.encodeWithSelector(MimirV3.challengeClaim.selector, id, STAKE, "", address(0))
        );
    }

    function _propose(uint256 id, uint8 side) internal {
        vm.warp(DEADLINE + 1);
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "proposed", 90, bytes32(uint256(1)));
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,,,,,,,, state,,,,,,,,) = mimir.getClaim(id);
    }

    /// The entry fee on one stake, and what a winner of the full pot gets: both net stakes.
    function _fee() internal pure returns (uint256) {
        return (STAKE * FEE_BPS) / 10_000;
    }

    function _netWin() internal pure returns (uint256) {
        return 2 * (STAKE - _fee());
    }

    // ── Flows ───────────────────────────────────────────────────────────────

    function test_smartAccountsPlayTheFullFlowAndArePaidDirectly() public {
        uint256 id = _create();
        _challenge(id);
        assert(_state(id) == mimir.ST_ACTIVE());
        assert(address(maker).balance == 98 * ONE);

        _propose(id, mimir.SIDE_CREATOR());
        assert(_state(id) == mimir.ST_PROPOSED());

        vm.warp(DEADLINE + 1 + WINDOW);
        vm.prank(keeper); // anyone may finalize
        mimir.finalizeResolution(id);

        // Pushed straight to the account, nothing parked.
        assert(_state(id) == mimir.ST_RESOLVED());
        assert(address(maker).balance == 98 * ONE + _netWin());
        assert(address(taker).balance == 98 * ONE);
        assert(mimir.pendingWithdrawals(address(maker)) == 0);
        // The two entry fees are all that is left.
        assert(address(mimir).balance == mimir.accruedFees(platform));
        assert(mimir.accruedFees(platform) == 2 * _fee());
        assert(mimir.wins(address(maker)) == 1 && mimir.losses(address(taker)) == 1);
    }

    function test_aSmartAccountDisputesAndIsPaidWithItsBond() public {
        uint256 id = _create();
        _challenge(id);
        _propose(id, mimir.SIDE_CREATOR());

        uint256 bond = mimir.MIN_STAKE();
        taker.execute(address(mimir), bond, abi.encodeWithSelector(MimirV3.disputeResolution.selector, id));
        assert(_state(id) == mimir.ST_DISPUTED());

        mimir.resolveDispute(id, mimir.SIDE_CHALLENGERS(), "arbiter", 100, bytes32(uint256(2)));
        // 100 - stake - bond + winnings + bond back.
        assert(address(taker).balance == 100 * ONE - STAKE + _netWin());
        assert(address(maker).balance == 98 * ONE);
        assert(address(mimir).balance == mimir.accruedFees(platform));
    }

    function test_aParkedPayoutIsPulledByTheAccount() public {
        uint256 id = _create();
        _challenge(id);
        _propose(id, mimir.SIDE_CREATOR());

        // The account cannot receive at settlement time (e.g. a module paused it).
        maker.setRefuse(true);
        vm.warp(DEADLINE + 1 + WINDOW);
        mimir.finalizeResolution(id);
        assert(_state(id) == mimir.ST_RESOLVED());
        assert(mimir.pendingWithdrawals(address(maker)) == _netWin());
        assert(address(maker).balance == 98 * ONE);

        // The app sees pendingWithdrawals > 0 and has the account pull it.
        maker.setRefuse(false);
        maker.execute(address(mimir), 0, abi.encodeWithSelector(MimirV3.withdraw.selector));
        assert(mimir.pendingWithdrawals(address(maker)) == 0);
        assert(address(maker).balance == 98 * ONE + _netWin());
        assert(address(mimir).balance == mimir.accruedFees(platform));
    }

    function test_anUnresolvedMarketRefundsBothAccounts() public {
        uint256 id = _create();
        _challenge(id);

        vm.warp(DEADLINE + mimir.RESOLUTION_GRACE_SECONDS());
        vm.prank(keeper);
        mimir.refundExpired(id);

        // Net stakes back; the entry fees stay earned.
        assert(address(maker).balance == 100 * ONE - _fee());
        assert(address(taker).balance == 100 * ONE - _fee());
        assert(address(mimir).balance == 2 * _fee());
    }
}
