// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Test stand-in for Circle's FiatToken v2 (Base USDC): 6 decimals, EIP-2612
 * permit, and a blacklist that makes any transfer from or to a listed account
 * revert. Switches for the transport edge cases the ERC-20 ports must survive:
 *   - noBool:      transfer/transferFrom return no data (USDT-style)
 *   - returnFalse: transfer/transferFrom return false instead of reverting
 *   - skim:        the recipient receives `skim` less than sent (fee-on-transfer)
 */
contract MockUsdc {
    string public constant name = "USD Coin";
    string public constant symbol = "USDC";
    string public constant version = "2";
    uint8 public constant decimals = 6;

    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    mapping(address => bool) public isBlacklisted;
    uint256 public totalSupply;

    bool public noBool;
    bool public returnFalse;
    uint256 public skim;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function blacklist(address a, bool on) external {
        isBlacklisted[a] = on;
    }

    function setNoBool(bool on) external {
        noBool = on;
    }

    function setReturnFalse(bool on) external {
        returnFalse = on;
    }

    function setSkim(uint256 amount) external {
        skim = amount;
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                address(this)
            )
        );
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _notListed(msg.sender);
        _notListed(spender);
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        require(deadline >= block.timestamp, "FiatTokenV2: permit is expired");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
            )
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == owner, "EIP2612: invalid signature");
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _notListed(msg.sender);
        if (returnFalse) return _ret(false);
        _move(msg.sender, to, amount);
        return _ret(true);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _notListed(msg.sender);
        if (returnFalse) return _ret(false);
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "ERC20: transfer amount exceeds allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return _ret(true);
    }

    function _move(address from, address to, uint256 amount) internal {
        _notListed(from);
        _notListed(to);
        require(to != address(0), "ERC20: transfer to the zero address");
        require(balanceOf[from] >= amount, "ERC20: transfer amount exceeds balance");
        balanceOf[from] -= amount;
        uint256 cut = skim < amount ? skim : amount;
        balanceOf[to] += amount - cut;
        totalSupply -= cut;
        emit Transfer(from, to, amount - cut);
    }

    function _notListed(address a) internal view {
        require(!isBlacklisted[a], "Blacklistable: account is blacklisted");
    }

    /// With noBool on, end the call with empty return data whatever the declared return type.
    function _ret(bool ok) internal view returns (bool) {
        if (noBool) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        return ok;
    }
}
