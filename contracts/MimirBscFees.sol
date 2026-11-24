// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MimirFees} from "./MimirFees.sol";

/// Minimal ERC-721 balance check for SPACE ID / Binance Agent ID (.ai) on BNB Chain.
interface IAgentIdRegistry {
    function balanceOf(address owner) external view returns (uint256);
}

/**
 * MimirBscFees: MimirFees with an immutable on-chain Binance Agent ID (.ai) discount.
 *
 * Any account holding at least one Agent ID NFT (`agentIdRegistry.balanceOf(account) > 0`)
 * pays AGENT_ID_BPS (0%) entry fee on MimirPoolErc20 and MimirV3Erc20.
 *
 * Safety:
 *   - `agentIdRegistry` is immutable (set at deploy; must have code if non-zero).
 *   - The external `balanceOf` call is bounded to 50,000 gas inside a try/catch so a
 *     reverting or gas-griefing external contract can never block market entry or settlement.
 *   - Non-holders fall back cleanly to standard MimirFees ticket tiers and BASE_BPS (0.5%).
 */
contract MimirBscFees is MimirFees {
    uint16 public constant AGENT_ID_BPS = 0; // 0% entry fee for Agent ID (.ai) holders
    uint256 private constant AGENT_ID_CALL_GAS = 50_000;

    IAgentIdRegistry public immutable agentIdRegistry;

    error NoCode();

    constructor(address _owner, address _signer, IAgentIdRegistry _agentIdRegistry) MimirFees(_owner, _signer) {
        if (address(_agentIdRegistry) != address(0) && address(_agentIdRegistry).code.length == 0) {
            revert NoCode();
        }
        agentIdRegistry = _agentIdRegistry;
    }

    function hasAgentId(address account) public view returns (bool) {
        if (address(agentIdRegistry) == address(0) || account == address(0)) return false;
        try agentIdRegistry.balanceOf{gas: AGENT_ID_CALL_GAS}(account) returns (uint256 bal) {
            return bal > 0;
        } catch {
            return false;
        }
    }

    /// Returns 0 bps for Agent ID (.ai) holders, otherwise the standard MimirFees tier rate.
    function entryBps(address account) external view override returns (uint16) {
        if (hasAgentId(account)) return AGENT_ID_BPS;
        Ticket memory t = tickets[account];
        if (t.expires <= block.timestamp || t.epoch != signerEpoch) return BASE_BPS;
        return t.tier == 2 ? WHALE_BPS : t.tier == 1 ? HOLDER_BPS : BASE_BPS;
    }
}
