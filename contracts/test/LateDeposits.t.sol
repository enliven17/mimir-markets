// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AuditAgentTest} from "./AuditAgent.t.sol";
import {MimirV3} from "../MimirV3.sol";
import {MimirPool} from "../MimirPool.sol";
import {MimirPoolErc20} from "../MimirPoolErc20.sol";

contract LateDepositsTest is AuditAgentTest {
    uint256 constant CUT = T0 + 100;
    function _unit(uint256 c) internal pure returns (uint256) { return c < 2 ? 1e18 : 1e6; }
    function _open(uint256 c, string memory mode) internal returns (uint256) {
        uint256 s = 10 * _unit(c);
        bytes memory data = c % 2 == 0
            ? abi.encodeCall(MimirV3.createClaim, ("Will it happen?", "Yes", "No", "https://example.com", DEADLINE, s, "custom", 0, "binary", mode, 20_000, "", "", 100, false, "", address(0)))
            : c < 2 ? abi.encodeCall(MimirPool.createMarket, ("Will it happen?", "Yes", "No", "https://example.com", "custom", DEADLINE, 1, address(0)))
            : abi.encodeCall(MimirPoolErc20.createMarket, ("Will it happen?", "Yes", "No", "https://example.com", "custom", DEADLINE, 1, address(0), s));
        return abi.decode(_must(c, CREATOR, data, c < 2 ? s : 0), (uint256));
    }
    function _stake(uint256 c, uint256 id, address user, uint8 side, uint256 dollars, address ref) internal {
        uint256 s = dollars * _unit(c);
        bytes memory data = c % 2 == 0 ? abi.encodeCall(MimirV3.challengeClaim, (id, s, "", ref))
            : c < 2 ? abi.encodeWithSignature("stake(uint256,uint8,address)", id, side, ref)
            : abi.encodeWithSignature("stake(uint256,uint8,address,uint256)", id, side, ref, s);
        _must(c, user, data, c < 2 ? s : 0);
    }
    function _proposeCut(uint256 c, uint256 id, uint8 side, uint256 cutoff) internal {
        vm.warp(PROPOSED);
        bytes memory data = c % 2 == 0
            ? abi.encodeWithSignature("resolveClaimWithCutoff(uint256,uint8,string,uint8,bytes32,uint256)", id, side, "result", 95, bytes32(0), cutoff)
            : abi.encodeWithSignature("resolveWithCutoff(uint256,uint8,string,bytes32,uint256)", id, side, "result", bytes32(0), cutoff);
        _must(c, ORACLE, data, 0);
    }
    function _finish(uint256 c, uint256 id) internal {
        vm.warp(PROPOSED + WINDOW);
        _must(c, ALICE, abi.encodeWithSignature(c % 2 == 0 ? "finalizeResolution(uint256)" : "finalize(uint256)", id), 0);
    }
    function _claim(uint256 c, uint256 id, address who) internal {
        if (c % 2 == 1) _must(c, who, abi.encodeWithSignature("claim(uint256)", id), 0);
    }
    function test_onlyLatePrincipalRefundedAndEarlyLossStillCounts() public {
        for (uint256 c; c < 4; c++) {
            vm.warp(T0); uint256 id = _open(c, "pool");
            _stake(c, id, ALICE, 2, 10, address(0));
            vm.warp(CUT); _stake(c, id, STRANGER, 2, 2, address(0));
            // Pools allow the same losing wallet to add a late deposit.
            if (c % 2 == 1) _stake(c, id, ALICE, 2, 3, address(0));
            uint256 creator = _balance(c, CREATOR); uint256 alice = _balance(c, ALICE); uint256 late = _balance(c, STRANGER);
            _proposeCut(c, id, 1, CUT); _finish(c, id);
            _claim(c, id, CREATOR); _claim(c, id, STRANGER);
            if (c % 2 == 1) _claim(c, id, ALICE);
            require(_balance(c, CREATOR) - creator == 20 * _unit(c), "late money entered winner pot");
            require(_balance(c, STRANGER) - late == 2 * _unit(c), "late principal not refunded");
            require(_balance(c, ALICE) - alice == (c % 2 == 1 ? 3 * _unit(c) : 0), "early losing stake escaped");
        }
    }
    function test_lateWinningStakeGetsNoProfitBothVsOddsModes() public {
        for (uint256 c; c < 4; c++) {
            vm.warp(T0); uint256 id = _open(c, "fixed");
            _stake(c, id, ALICE, 2, 5, address(0));
            vm.warp(CUT); _stake(c, id, STRANGER, 2, 2, address(0));
            uint256 creator = _balance(c, CREATOR); uint256 alice = _balance(c, ALICE); uint256 late = _balance(c, STRANGER);
            _proposeCut(c, id, 2, CUT); _finish(c, id);
            _claim(c, id, ALICE); _claim(c, id, STRANGER);
            require(_balance(c, STRANGER) - late == 2 * _unit(c), "late winner profited");
            require(_balance(c, ALICE) - alice == (c % 2 == 0 ? 10 : 15) * _unit(c), "valid winner payout changed");
            if (c % 2 == 0) require(_balance(c, CREATOR) - creator == 5 * _unit(c), "late liability consumed creator stake");
        }
    }
    function test_allLateAndNoEligibleOppositionRefundWithoutProfit() public {
        for (uint256 c; c < 4; c++) {
            vm.warp(CUT); uint256 id = _open(c, "pool");
            _stake(c, id, ALICE, 2, 10, address(0));
            uint256 a = _balance(c, CREATOR); uint256 b = _balance(c, ALICE);
            _proposeCut(c, id, 2, CUT); _finish(c, id); _claim(c, id, CREATOR); _claim(c, id, ALICE);
            require(_balance(c, CREATOR) - a == 10 * _unit(c));
            require(_balance(c, ALICE) - b == 10 * _unit(c));
        }
    }
    function test_arbiterCanCorrectCutoffWithoutChangingSideAndReturnsBond() public {
        for (uint256 c; c < 4; c++) {
            vm.warp(T0); uint256 id = _open(c, "pool"); _stake(c, id, ALICE, 2, 10, address(0));
            vm.warp(CUT); _stake(c, id, STRANGER, 2, 2, address(0));
            _proposeCut(c, id, 1, 0); _set(c, AUDIT);
            uint256 before = _balance(c, AUDIT); require(_dispute(c, id, AUDIT));
            bytes memory data = c % 2 == 0
                ? abi.encodeWithSignature("resolveDisputeWithCutoff(uint256,uint8,string,uint8,bytes32,uint256)", id, 1, "correct cutoff", 95, bytes32(0), CUT)
                : abi.encodeWithSignature("resolveDisputeWithCutoff(uint256,uint8,string,bytes32,uint256)", id, 1, "correct cutoff", bytes32(0), CUT);
            _must(c, ARBITER, data, 0);
            require(_balance(c, AUDIT) == before, "correct cutoff challenger lost bond");
            uint256 late = _balance(c, STRANGER); _claim(c, id, STRANGER);
            if (c % 2 == 1) require(_balance(c, STRANGER) - late == 2 * _unit(c));
        }
    }
    function test_earlyCreatorWithOnlyLateOppositionGetsPrincipalNotProfit() public {
        for (uint256 c; c < 4; c++) {
            vm.warp(T0); uint256 id = _open(c, "pool");
            vm.warp(CUT); _stake(c, id, ALICE, 2, 2, address(0));
            uint256 a = _balance(c, CREATOR); uint256 b = _balance(c, ALICE);
            _proposeCut(c, id, 1, CUT); _finish(c, id); _claim(c, id, CREATOR); _claim(c, id, ALICE);
            require(_balance(c, CREATOR) - a == 10 * _unit(c));
            require(_balance(c, ALICE) - b == 2 * _unit(c));
        }
    }
    function test_timeoutHonorsProposedCutoffAndEarlyLoss() public {
        for (uint256 c; c < 4; c++) {
            vm.warp(T0); uint256 id = _open(c, "pool"); _stake(c, id, ALICE, 2, 10, address(0));
            vm.warp(CUT); _stake(c, id, STRANGER, 2, 2, address(0));
            uint256 a = _balance(c, CREATOR); uint256 b = _balance(c, ALICE); uint256 late = _balance(c, STRANGER);
            _proposeCut(c, id, 1, CUT); require(_dispute(c, id, ALICE));
            vm.warp(PROPOSED + 7 days); _must(c, STRANGER, abi.encodeWithSignature("refundExpired(uint256)", id), 0);
            _claim(c, id, CREATOR); _claim(c, id, STRANGER);
            require(_balance(c, CREATOR) - a == 20 * _unit(c), "timeout lost eligibility");
            require(_balance(c, ALICE) == b - 2 * _unit(c), "timeout refunded early loser or bond");
            require(_balance(c, STRANGER) - late == 2 * _unit(c));
        }
    }
    function test_poolLateLosingHedgeDoesNotReduceCopyFeesOrWinProfit() public {
        for (uint256 c = 1; c < 4; c += 2) {
            vm.warp(T0); uint256 id = _open(c, "pool");
            _stake(c, id, ALICE, 1, 10, AUDIT); _stake(c, id, STRANGER, 2, 20, address(0));
            vm.warp(CUT); _stake(c, id, ALICE, 2, 10, address(0)); _stake(c, id, ALICE, 1, 5, AUDIT);
            uint256 alice = _balance(c, ALICE);
            _proposeCut(c, id, 1, CUT); _finish(c, id); _claim(c, id, ALICE);
            // Eligible prize is 20, plus 15 late principal, less 2% of 10 valid copied profit.
            require(_balance(c, ALICE) - alice == 348 * _unit(c) / 10, "late hedge changed fees");
            (bool ok, bytes memory out) = markets[c].staticcall(abi.encodeWithSignature("accruedFees(address)", AUDIT));
            require(ok && abi.decode(out, (uint256)) == _unit(c) / 10, "referrer fee used late money");
            (ok,) = _call(c, ALICE, abi.encodeWithSignature("claim(uint256)", id), 0); require(!ok, "refund replayed");
        }
    }
    function test_poolPureLateRefundWorksWhilePausedAndWinnerWaits() public {
        for (uint256 c = 1; c < 4; c += 2) {
            vm.warp(T0); uint256 id = _open(c, "pool"); _stake(c, id, ALICE, 2, 10, address(0));
            vm.warp(CUT); _stake(c, id, STRANGER, 1, 2, address(0));
            _proposeCut(c, id, 1, CUT); _finish(c, id);
            _must(c, address(this), abi.encodeWithSignature("setPaused(bool)", true), 0);
            uint256 late = _balance(c, STRANGER); _claim(c, id, STRANGER);
            require(_balance(c, STRANGER) - late == 2 * _unit(c));
            (bool ok,) = _call(c, CREATOR, abi.encodeWithSignature("claim(uint256)", id), 0); require(!ok);
            _must(c, address(this), abi.encodeWithSignature("setPaused(bool)", false), 0); _claim(c, id, CREATOR);
        }
    }
    function test_cutoffCannotBeSetByStrangerOrMutatedAfterProposalOrFinalization() public {
        for (uint256 c; c < 4; c++) {
            vm.warp(T0); uint256 id = _open(c, "pool"); _stake(c, id, ALICE, 2, 10, address(0));
            vm.warp(PROPOSED);
            bytes memory data = c % 2 == 0
                ? abi.encodeWithSignature("resolveClaimWithCutoff(uint256,uint8,string,uint8,bytes32,uint256)", id, 1, "result", 95, bytes32(0), CUT)
                : abi.encodeWithSignature("resolveWithCutoff(uint256,uint8,string,bytes32,uint256)", id, 1, "result", bytes32(0), CUT);
            (bool ok,) = _call(c, STRANGER, data, 0); require(!ok);
            _proposeCut(c, id, 1, CUT);
            (ok,) = _call(c, ORACLE, data, 0); require(!ok);
            _finish(c, id);
            (ok,) = _call(c, ORACLE, data, 0); require(!ok);
        }
    }

    function test_vsPoolWinnerAndCopyFeesExcludeLateChallenger() public {
        for (uint256 c; c < 4; c += 2) {
            vm.warp(T0); uint256 id = _open(c, "pool"); _stake(c, id, ALICE, 2, 5, AUDIT);
            vm.warp(CUT); _stake(c, id, STRANGER, 2, 2, AUDIT);
            uint256 alice = _balance(c, ALICE); uint256 late = _balance(c, STRANGER);
            _proposeCut(c, id, 2, CUT); _finish(c, id);
            require(_balance(c, ALICE) - alice == 148 * _unit(c) / 10);
            require(_balance(c, STRANGER) - late == 2 * _unit(c));
            (bool ok, bytes memory out) = markets[c].staticcall(abi.encodeWithSignature("accruedFees(address)", AUDIT));
            require(ok && abi.decode(out, (uint256)) == _unit(c) / 10);
        }
    }

}
