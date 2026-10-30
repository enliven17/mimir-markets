// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * MimirAgentPay: pay a Mimir agent for one Mimir API call in USDC on Base.
 *
 * The caller asks Mimir for a quote (GET /api/launch/:id/call), which names the
 * agent's own wallet, the price and a fresh `callId`. It then calls `pay` (after
 * an approve) or `payWithPermit` (one tx, EIP-2612), and sends the tx hash to
 * Mimir in `X-Mimir-Payment: base:<tx>`. Mimir reads the `Paid` event from the
 * receipt: one tx buys one call.
 *
 * Non-custodial: USDC moves from the payer straight to the agent in the same
 * call; this contract never holds funds, takes no fee and has no owner, no
 * admin and no upgrade path. The only state is the set of used call ids, so a
 * quote can be paid once and a double click cannot pay twice.
 */
interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC20PermitLike {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

contract MimirAgentPay {
    /// The USDC this contract moves (Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).
    address public immutable usdc;
    /// A call id that already paid for a call.
    mapping(bytes32 => bool) public used;

    event Paid(bytes32 indexed callId, address indexed agent, address indexed payer, uint256 amount);

    error ZeroAddress();
    error NotAContract();
    error ZeroAmount();
    error BadAgent();
    error BadCallId();
    error CallIdUsed();
    error TransferFailed();

    constructor(address usdc_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        if (usdc_.code.length == 0) revert NotAContract();
        usdc = usdc_;
    }

    /// Pays `agent` `amount` USDC (6 dp) from the caller for the call `callId`. Needs an allowance.
    function pay(address agent, uint256 amount, bytes32 callId) external {
        _pay(agent, amount, callId);
    }

    /**
     * `pay` with an EIP-2612 permit for this contract, so no separate approve tx.
     * A permit that fails (already used, e.g. front-run from the mempool) is
     * ignored when the allowance is already there; the transfer decides.
     */
    function payWithPermit(
        address agent,
        uint256 amount,
        bytes32 callId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        try IERC20PermitLike(usdc).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _pay(agent, amount, callId);
    }

    function _pay(address agent, uint256 amount, bytes32 callId) private {
        if (agent == address(0)) revert ZeroAddress();
        if (agent == address(this)) revert BadAgent();
        if (amount == 0) revert ZeroAmount();
        if (callId == bytes32(0)) revert BadCallId();
        if (used[callId]) revert CallIdUsed();
        used[callId] = true;
        // SafeERC20-style: tokens that return nothing count as success; false or a revert does not.
        (bool ok, bytes memory ret) =
            usdc.call(abi.encodeWithSelector(IERC20Like.transferFrom.selector, msg.sender, agent, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        emit Paid(callId, agent, msg.sender, amount);
    }
}
