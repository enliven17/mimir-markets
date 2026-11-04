// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3, IMimirFees as IV3Fees} from "../MimirV3.sol";
import {MimirPool, IMimirFees as IPoolFees} from "../MimirPool.sol";
import {MimirV3Erc20, IMimirFees as IErcV3Fees, IUsdc as IV3Usdc} from "../MimirV3Erc20.sol";
import {MimirPoolErc20, IMimirFees as IErcPoolFees, IUsdc as IPoolUsdc} from "../MimirPoolErc20.sol";
import {FlatFees} from "./FlatFees.sol";
import {MockUsdc} from "./MockUsdc.sol";

interface AuditVm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
}

/** Same admission and lifecycle assertions against native/ERC20 VS and pool. */
contract AuditAgentTest {
    AuditVm constant vm = AuditVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant CREATOR = address(0xC7);
    address constant ALICE = address(0xA11CE);
    address constant AUDIT = address(0xA0D17);
    address constant STRANGER = address(0xBAD);
    address constant ARBITER = address(0xA2B1);
    address constant ORACLE = address(0x0417);
    address constant TREASURY = address(0xFEE);
    uint256 constant T0 = 1_000_000;
    uint256 constant DEADLINE = T0 + 1 days;
    uint256 constant PROPOSED = DEADLINE + 1;
    uint256 constant WINDOW = 1 hours;
    address[4] markets;
    MockUsdc usdc;

    receive() external payable {}

    function setUp() public {
        vm.warp(T0);
        usdc = new MockUsdc();
        address fees = address(new FlatFees(0));
        markets[0] = address(new MimirV3(address(this), ARBITER, ORACLE, TREASURY, IV3Fees(fees), WINDOW, 1e17));
        markets[1] = address(new MimirPool(address(this), ARBITER, ORACLE, TREASURY, IPoolFees(fees), WINDOW, 1e17));
        markets[2] = address(new MimirV3Erc20(address(this), ARBITER, ORACLE, TREASURY, IErcV3Fees(fees), WINDOW, 1e5, IV3Usdc(address(usdc))));
        markets[3] = address(new MimirPoolErc20(address(this), ARBITER, ORACLE, TREASURY, IErcPoolFees(fees), WINDOW, 1e5, IPoolUsdc(address(usdc))));
        address[5] memory users = [CREATOR, ALICE, AUDIT, STRANGER, ARBITER];
        for (uint256 i; i < users.length; i++) {
            vm.deal(users[i], 1_000e18);
            usdc.mint(users[i], 1_000e6);
            for (uint256 j = 2; j < 4; j++) {
                vm.prank(users[i]); usdc.approve(markets[j], type(uint256).max);
            }
        }
    }

    function _call(uint256 c, address who, bytes memory data, uint256 value) internal returns (bool ok, bytes memory out) {
        vm.prank(who); return markets[c].call{value: value}(data);
    }
    function _must(uint256 c, address who, bytes memory data, uint256 value) internal returns (bytes memory) {
        (bool ok, bytes memory out) = _call(c, who, data, value); require(ok, "required market call failed"); return out;
    }
    function _set(uint256 c, address who) internal {
        (bool ok,) = markets[c].call(abi.encodeWithSignature("setAuditAgent(address)", who));
        require(ok, "missing owner audit-role setter");
    }
    function _readAudit(uint256 c) internal view returns (address) {
        (bool ok, bytes memory out) = markets[c].staticcall(abi.encodeWithSignature("auditAgent()"));
        require(ok && out.length == 32, "missing audit-role getter"); return abi.decode(out, (address));
    }
    function _state(uint256 c, uint256 id) internal view returns (uint256 state) {
        (bool ok, bytes memory out) = markets[c].staticcall(abi.encodeWithSignature(c % 2 == 0 ? "getClaim(uint256)" : "getMarket(uint256)", id));
        require(ok); uint256 word = c % 2 == 0 ? 9 : 3;
        assembly { state := mload(add(add(out, 32), mul(word, 32))) }
    }
    function _balance(uint256 c, address who) internal view returns (uint256) { return c < 2 ? who.balance : usdc.balanceOf(who); }
    function _dispute(uint256 c, uint256 id, address who) internal returns (bool ok) {
        (ok,) = _call(c, who, abi.encodeWithSignature(c % 2 == 0 ? "disputeResolution(uint256)" : "dispute(uint256)", id), c < 2 ? 2e18 : 0);
    }
    function _resolve(uint256 c, uint256 id, address who, uint8 side) internal returns (bool ok) {
        bytes memory data = c % 2 == 0
            ? abi.encodeWithSignature("resolveDisputeWithCutoff(uint256,uint8,string,uint8,bytes32,uint256)", id, side, "review", 95, bytes32(0), uint256(0))
            : abi.encodeWithSignature("resolveDispute(uint256,uint8,string,bytes32)", id, side, "review", bytes32(0));
        (ok,) = _call(c, who, data, 0);
    }
    function _proposals() internal returns (uint256[4] memory ids) {
        for (uint256 c; c < 4; c++) {
            uint256 stake = c < 2 ? 10e18 : 10e6;
            if (c % 2 == 0) {
                ids[c] = abi.decode(_must(c, CREATOR, abi.encodeCall(MimirV3.createClaim, ("Will the event happen?", "Yes", "No", "https://example.com", DEADLINE, stake, "custom", 0, "binary", "pool", 0, "", "", 100, true, "", address(0))), c < 2 ? stake : 0), (uint256));
                address[] memory invited = new address[](1); invited[0] = ALICE;
                _must(c, CREATOR, abi.encodeWithSignature("setInvited(uint256,address[],bool)", ids[c], invited, true), 0);
                _must(c, ALICE, abi.encodeCall(MimirV3.challengeClaim, (ids[c], stake, "", address(0))), c < 2 ? stake : 0);
            } else {
                bytes memory data = c < 2
                    ? abi.encodeCall(MimirPool.createMarket, ("Will the event happen?", "Yes", "No", "https://example.com", "custom", DEADLINE, 1, address(0)))
                    : abi.encodeCall(MimirPoolErc20.createMarket, ("Will the event happen?", "Yes", "No", "https://example.com", "custom", DEADLINE, 1, address(0), stake));
                ids[c] = abi.decode(_must(c, CREATOR, data, c < 2 ? stake : 0), (uint256));
                data = c < 2 ? abi.encodeWithSignature("stake(uint256,uint8,address)", ids[c], 2, address(0)) : abi.encodeWithSignature("stake(uint256,uint8,address,uint256)", ids[c], 2, address(0), stake);
                _must(c, ALICE, data, c < 2 ? stake : 0);
            }
        }
        vm.warp(PROPOSED);
        for (uint256 c; c < 4; c++) {
            bytes memory data = c % 2 == 0 ? abi.encodeCall(MimirV3.resolveClaimWithCutoff, (ids[c], 1, "proposal", 95, bytes32(0), 0)) : abi.encodeCall(MimirPool.resolve, (ids[c], 1, "proposal", bytes32(0)));
            _must(c, ORACLE, data, 0);
        }
    }

    function test_unstakedAuditCanDisputeButCannotArbitrateAndCorrectChallengeReturnsBond() public {
        uint256[4] memory ids = _proposals();
        for (uint256 c; c < 4; c++) {
            _set(c, AUDIT);
            uint256 before = _balance(c, AUDIT);
            require(!_dispute(c, ids[c], STRANGER), "stranger gained admission");
            require(_dispute(c, ids[c], AUDIT), "audit was not admitted");
            require(_state(c, ids[c]) == (c % 2 == 0 ? 5 : 2));
            require(!_dispute(c, ids[c], AUDIT), "duplicate dispute");
            require(!_resolve(c, ids[c], AUDIT, 2), "audit gained arbiter authority");
            require(_resolve(c, ids[c], ARBITER, 2));
            require(_balance(c, AUDIT) == before, "correct audit bond not returned");
        }
    }
    function test_unstakedArbiterCanDisputeAndRule() public {
        uint256[4] memory ids = _proposals();
        for (uint256 c; c < 4; c++) { require(_dispute(c, ids[c], ARBITER), "arbiter was not admitted"); require(_resolve(c, ids[c], ARBITER, 2)); }
    }
    function test_revocationRetainsBettorRightsButRemovesUnstakedAuditAccess() public {
        uint256[4] memory ids = _proposals();
        for (uint256 c; c < 4; c++) {
            _set(c, AUDIT); _set(c, address(0)); require(!_dispute(c, ids[c], AUDIT), "revoked audit admitted");
            _set(c, ALICE); _set(c, address(0)); require(_dispute(c, ids[c], ALICE), "bettor lost dispute right");
        }
    }
    function test_onlyOwnerCanRotateAndZeroDisablesRole() public {
        for (uint256 c; c < 4; c++) {
            _set(c, AUDIT); require(_readAudit(c) == AUDIT);
            (bool ok,) = _call(c, STRANGER, abi.encodeWithSignature("setAuditAgent(address)", STRANGER), 0); require(!ok);
            _set(c, STRANGER); require(_readAudit(c) == STRANGER);
            _set(c, address(0)); require(_readAudit(c) == address(0));
        }
    }
    function test_auditMustBeSeparateFromCurrentPrivilegedRoles() public {
        address[4] memory roles = [address(this), ARBITER, ORACLE, TREASURY];
        for (uint256 c; c < 4; c++) {
            _set(c, AUDIT);
            for (uint256 i; i < 4; i++) { (bool assigned,) = markets[c].call(abi.encodeWithSignature("setAuditAgent(address)", roles[i])); require(!assigned, "colliding audit assigned"); }
            (bool ok,) = markets[c].call(abi.encodeWithSignature("setArbiter(address)", AUDIT)); require(!ok, "audit became arbiter");
        }
    }
    function test_queuedOracleCannotActivateAsAuditInEitherOrder() public {
        for (uint256 c; c < 4; c++) {
            _must(c, address(this), abi.encodeWithSignature("queueOracle(address)", AUDIT), 0);
            _set(c, AUDIT); vm.warp(block.timestamp + 3 days);
            (bool ok,) = markets[c].call(abi.encodeWithSignature("executeOracle()")); require(!ok, "queued oracle bypassed audit separation");
            _must(c, address(this), abi.encodeWithSignature("cancelOracle()"), 0);
            (ok,) = markets[c].call(abi.encodeWithSignature("queueOracle(address)", AUDIT));
            if (ok) { vm.warp(block.timestamp + 3 days); (ok,) = markets[c].call(abi.encodeWithSignature("executeOracle()")); require(!ok); }
        }
    }
    function test_queuedOwnerAndFeeCannotActivateAsAudit() public {
        for (uint256 c; c < 4; c++) {
            _must(c, address(this), abi.encodeWithSignature("transferOwnership(address)", AUDIT), 0);
            _must(c, address(this), abi.encodeWithSignature("queueFeeRecipient(address)", AUDIT), 0);
            _set(c, AUDIT); vm.warp(block.timestamp + 3 days);
            (bool ok,) = _call(c, AUDIT, abi.encodeWithSignature("acceptOwnership()"), 0); require(!ok, "queued owner bypassed audit separation");
            (ok,) = markets[c].call(abi.encodeWithSignature("executeFeeRecipient()")); require(!ok, "queued fee bypassed audit separation");
        }
    }
    function test_wrongBondAndWindowBoundaryStillRejectAudit() public {
        uint256[4] memory ids = _proposals();
        for (uint256 c; c < 4; c++) {
            _set(c, AUDIT);
            if (c < 2) { (bool ok,) = _call(c, AUDIT, abi.encodeWithSignature(c == 0 ? "disputeResolution(uint256)" : "dispute(uint256)", ids[c]), 2e18 - 1); require(!ok); }
            else { vm.prank(AUDIT); usdc.approve(markets[c], 0); require(!_dispute(c, ids[c], AUDIT), "audit spent without allowance"); }
        }
        vm.warp(PROPOSED + WINDOW);
        for (uint256 c; c < 4; c++) require(!_dispute(c, ids[c], AUDIT), "audit bypassed dispute deadline");
    }
    function test_unruledAuditKeepsExistingOrdinaryDisputeTimeoutAndBond() public {
        uint256[4] memory ids = _proposals();
        for (uint256 c; c < 4; c++) { _set(c, AUDIT); require(_dispute(c, ids[c], AUDIT)); }
        vm.warp(PROPOSED + 7 days);
        for (uint256 c; c < 4; c++) {
            _must(c, STRANGER, abi.encodeWithSignature("refundExpired(uint256)", ids[c]), 0);
            // The same audit account bonded two markets in each currency.
            require(_balance(c, AUDIT) == (c < 2 ? 996e18 : 996e6), "timeout changed audit bond policy");
        }
    }
    function test_wrongAuditLosesBond() public {
        uint256[4] memory ids = _proposals();
        for (uint256 c; c < 4; c++) {
            _set(c, AUDIT);uint256 before = _balance(c, AUDIT);require(_dispute(c, ids[c], AUDIT));
            require(_resolve(c, ids[c], ARBITER, 1));
            require(_balance(c, AUDIT) == before - (c < 2 ? 2e18 : 2e6), "incorrect audit recovered bond");
        }
    }
    function test_pausedAuditDisputeRefundsAndReturnsBond() public {
        uint256[4] memory ids = _proposals();
        for (uint256 c; c < 4; c++) { _set(c, AUDIT);require(_dispute(c, ids[c], AUDIT));_must(c, address(this), abi.encodeWithSignature("setPaused(bool)", true), 0); }
        vm.warp(PROPOSED + 7 days);
        for (uint256 c; c < 4; c++) {
            uint256 before = _balance(c, AUDIT);
            _must(c, STRANGER, abi.encodeWithSignature("refundExpired(uint256)", ids[c]), 0);
            require(_balance(c, AUDIT) == before + (c < 2 ? 2e18 : 2e6));
        }
    }
    function test_poolPermitRoutesThroughTheSameAuditAdmission() public {
        uint256[4] memory ids = _proposals();
        uint256 privateKey = 0xA0D17;address signer = vm.addr(privateKey);_set(3, signer);usdc.mint(signer, 2e6);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), keccak256(abi.encode(usdc.PERMIT_TYPEHASH(), signer, markets[3], 2e6, usdc.nonces(signer), PROPOSED + WINDOW))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        _must(3, signer, abi.encodeWithSignature("disputeWithPermit(uint256,uint256,uint8,bytes32,bytes32)", ids[3], PROPOSED + WINDOW, v, r, s), 0);
        require(_state(3, ids[3]) == 2);
    }
    function test_allRuntimesRemainDeployable() public view {
        for (uint256 c; c < 4; c++) require(markets[c].code.length <= 24_576, "EIP170 runtime exceeded");
    }
}
