// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirAgentPay} from "../MimirAgentPay.sol";

/**
 * MimirAgentPay: USDC goes from the payer straight to the agent, each call id
 * pays once, and bad input or a failed transfer reverts. Dependency-free like
 * the rest of the suite: a minimal USDC-like token with EIP-2612 permit.
 */
interface Vm {
    function prank(address) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function expectEmit(bool, bool, bool, bool) external;
}

contract MockUSDC {
    enum Mode {
        Normal,
        ReturnsFalse,
        Reverts,
        ReturnsNothing
    }

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    Mode public mode;

    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 public immutable DOMAIN_SEPARATOR = keccak256(
        abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("USD Coin"),
            keccak256("2"),
            block.chainid,
            address(this)
        )
    );

    function setMode(Mode m) external {
        mode = m;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        require(block.timestamp <= deadline, "expired");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
            )
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == owner, "bad sig");
        allowance[owner][spender] = value;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (mode == Mode.Reverts) revert("blocked");
        if (mode == Mode.ReturnsFalse) return false;
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        if (mode == Mode.ReturnsNothing) {
            assembly {
                return(0, 0)
            }
        }
        return true;
    }
}

contract MimirAgentPayTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event Paid(bytes32 indexed callId, address indexed agent, address indexed payer, uint256 amount);

    MockUSDC usdc;
    MimirAgentPay pay;
    uint256 constant PAYER_KEY = 0xCA11E2;
    address payer;
    address agent = address(0xA9E7);
    bytes32 constant CALL = keccak256("call-1");
    uint256 constant PRICE = 50_000; // 0.05 USDC

    function setUp() public {
        usdc = new MockUSDC();
        pay = new MimirAgentPay(address(usdc));
        payer = vm.addr(PAYER_KEY);
        usdc.mint(payer, 10_000_000);
        vm.prank(payer);
        usdc.approve(address(pay), type(uint256).max);
    }

    function _pay(address to, uint256 amount, bytes32 id) internal returns (bool ok, bytes memory ret) {
        vm.prank(payer);
        (ok, ret) = address(pay).call(abi.encodeWithSelector(MimirAgentPay.pay.selector, to, amount, id));
    }

    function _err(bytes4 sel) internal pure returns (bytes32) {
        return keccak256(abi.encodeWithSelector(sel));
    }

    function _permitSig(uint256 value, uint256 deadline) internal returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdc.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(usdc.PERMIT_TYPEHASH(), payer, address(pay), value, usdc.nonces(payer), deadline))
            )
        );
        (v, r, s) = vm.sign(PAYER_KEY, digest);
    }

    // ── Paying ──────────────────────────────────────────────────────────────

    function test_payMovesUsdcStraightToTheAgent() public {
        vm.expectEmit(true, true, true, true);
        emit Paid(CALL, agent, payer, PRICE);
        (bool ok,) = _pay(agent, PRICE, CALL);
        assert(ok);
        assert(usdc.balanceOf(agent) == PRICE);
        assert(usdc.balanceOf(payer) == 10_000_000 - PRICE);
        assert(usdc.balanceOf(address(pay)) == 0);
        assert(pay.used(payer, CALL));
    }

    function test_aTokenThatReturnsNothingStillPays() public {
        usdc.setMode(MockUSDC.Mode.ReturnsNothing);
        (bool ok,) = _pay(agent, PRICE, CALL);
        assert(ok && usdc.balanceOf(agent) == PRICE);
    }

    function test_payWithPermitNeedsNoApprove() public {
        vm.prank(payer);
        usdc.approve(address(pay), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(PRICE, deadline);
        vm.prank(address(0xBEEF)); // the payer is msg.sender: a relayer cannot spend the payer's permit
        (bool relayed,) = address(pay).call(
            abi.encodeWithSelector(MimirAgentPay.payWithPermit.selector, agent, PRICE, CALL, deadline, v, r, s)
        );
        assert(!relayed); // the permit is for the payer, the relayer has no allowance
        vm.prank(payer);
        pay.payWithPermit(agent, PRICE, CALL, deadline, v, r, s);
        assert(usdc.balanceOf(agent) == PRICE);
        assert(usdc.allowance(payer, address(pay)) == 0);
    }

    function test_aFrontRunPermitDoesNotBlockThePayment() public {
        vm.prank(payer);
        usdc.approve(address(pay), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(PRICE, deadline);
        usdc.permit(payer, address(pay), PRICE, deadline, v, r, s); // someone submits it first
        vm.prank(payer);
        pay.payWithPermit(agent, PRICE, CALL, deadline, v, r, s);
        assert(usdc.balanceOf(agent) == PRICE);
    }

    function test_aBadPermitWithoutAllowanceReverts() public {
        vm.prank(payer);
        usdc.approve(address(pay), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(PRICE - 1, deadline); // signed for less
        vm.prank(payer);
        (bool ok, bytes memory ret) = address(pay).call(
            abi.encodeWithSelector(MimirAgentPay.payWithPermit.selector, agent, PRICE, CALL, deadline, v, r, s)
        );
        assert(!ok && keccak256(ret) == _err(MimirAgentPay.TransferFailed.selector));
        assert(!pay.used(payer, CALL));
    }

    // ── Refusals ────────────────────────────────────────────────────────────

    function test_aCallIdPaysOnce() public {
        (bool first,) = _pay(agent, PRICE, CALL);
        (bool again, bytes memory r) = _pay(agent, PRICE, CALL);
        assert(first && !again && keccak256(r) == _err(MimirAgentPay.CallIdUsed.selector));
        assert(usdc.balanceOf(agent) == PRICE);
    }

    function test_someoneElseCannotSpendAPendingCallId() public {
        address other = address(0xA77);
        usdc.mint(other, 1);
        vm.prank(other);
        usdc.approve(address(pay), 1);
        vm.prank(other);
        pay.pay(agent, 1, CALL); // front-runs the payer's id with 1 unit
        (bool ok,) = _pay(agent, PRICE, CALL); // the payer's own payment still goes through
        assert(ok && pay.used(payer, CALL) && pay.used(other, CALL));
        assert(usdc.balanceOf(agent) == PRICE + 1);
    }

    function test_zeroAgentAmountOrCallIdReverts() public {
        (bool a, bytes memory ra) = _pay(address(0), PRICE, CALL);
        assert(!a && keccak256(ra) == _err(MimirAgentPay.ZeroAddress.selector));
        (bool b, bytes memory rb) = _pay(agent, 0, CALL);
        assert(!b && keccak256(rb) == _err(MimirAgentPay.ZeroAmount.selector));
        (bool c, bytes memory rc) = _pay(agent, PRICE, bytes32(0));
        assert(!c && keccak256(rc) == _err(MimirAgentPay.BadCallId.selector));
        (bool d, bytes memory rd) = _pay(address(pay), PRICE, CALL);
        assert(!d && keccak256(rd) == _err(MimirAgentPay.BadAgent.selector));
        assert(!pay.used(payer, CALL));
    }

    function test_aFailedTransferRevertsAndLeavesTheCallIdUnused() public {
        usdc.setMode(MockUSDC.Mode.ReturnsFalse);
        (bool f, bytes memory rf) = _pay(agent, PRICE, CALL);
        assert(!f && keccak256(rf) == _err(MimirAgentPay.TransferFailed.selector));
        usdc.setMode(MockUSDC.Mode.Reverts);
        (bool r, bytes memory rr) = _pay(agent, PRICE, CALL);
        assert(!r && keccak256(rr) == _err(MimirAgentPay.TransferFailed.selector));
        usdc.setMode(MockUSDC.Mode.Normal);
        (bool short, bytes memory rs) = _pay(agent, 10_000_001, CALL); // more than the payer has
        assert(!short && keccak256(rs) == _err(MimirAgentPay.TransferFailed.selector));
        assert(!pay.used(payer, CALL) && usdc.balanceOf(agent) == 0);
    }

    function test_theConstructorRefusesANonToken() public {
        (bool z,) = address(this).call(abi.encodeWithSelector(this.deploy.selector, address(0)));
        (bool e,) = address(this).call(abi.encodeWithSelector(this.deploy.selector, address(0xE0A)));
        assert(!z && !e);
    }

    function deploy(address token) external returns (address) {
        return address(new MimirAgentPay(token));
    }
}
