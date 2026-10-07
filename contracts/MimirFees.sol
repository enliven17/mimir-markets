// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * MimirFees: the entry-fee rate each account pays on MimirV3 and MimirPool.
 *
 * Everyone pays BASE_BPS (0.5%) of what they put in. $MIMIR holders pay less,
 * but the token lives on Solana and this contract cannot read it, so Mimir's
 * server checks the account's linked Solana wallet and signs a FeeTicket
 * (EIP-712): "this account is tier T until `expires`". The account submits it
 * with applyTicket, normally in the same user operation as its bet.
 *
 * Trust: the signer can only lower an account's rate (BASE_BPS is the most
 * anyone pays), so a stolen signer key costs the protocol revenue, never a
 * user money. That is why rotating it is immediate, not timelocked.
 */
contract MimirFees {
    uint16 public constant BASE_BPS = 50; // 0.5%
    uint16 public constant HOLDER_BPS = 25; // 0.25%: 5M+ $MIMIR
    uint16 public constant WHALE_BPS = 10; // 0.1%: 10M+ $MIMIR
    /// A ticket may not outlive this, so a sold bag stops discounting within two days.
    uint256 public constant MAX_TICKET_SECONDS = 2 days;
    uint256 public constant OWNERSHIP_TIMELOCK_SECONDS = 2 days;

    bytes32 public constant TICKET_TYPEHASH = keccak256("FeeTicket(address account,uint8 tier,uint64 expires)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    /// secp256k1n / 2: signatures with a higher s are the malleable twin and are refused.
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    struct Ticket {
        uint8 tier;
        uint64 expires;
    }

    mapping(address => Ticket) public tickets;
    address public signer;
    address public owner;
    address public pendingOwner;
    uint256 public pendingOwnerEta;

    event TicketApplied(address indexed account, uint8 tier, uint64 expires);
    event SignerChanged(address indexed previous, address indexed next);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner, uint256 eta);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error Timelocked();
    error ZeroAddress();
    error BadTier();
    error BadExpiry();
    error BadSignature();

    constructor(address _signer) {
        if (_signer == address(0)) revert ZeroAddress();
        owner = msg.sender;
        signer = _signer;
        emit OwnershipTransferred(address(0), msg.sender);
        emit SignerChanged(address(0), _signer);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setSigner(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit SignerChanged(signer, next);
        signer = next;
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        pendingOwner = next;
        pendingOwnerEta = block.timestamp + OWNERSHIP_TIMELOCK_SECONDS;
        emit OwnershipTransferStarted(owner, next, pendingOwnerEta);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        if (block.timestamp < pendingOwnerEta) revert Timelocked();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
        pendingOwnerEta = 0;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Mimir Fees"), keccak256("1"), block.chainid, address(this)));
    }

    /// The digest the signer signs for (account, tier, expires).
    function ticketDigest(address account, uint8 tier, uint64 expires) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19\x01", domainSeparator(), keccak256(abi.encode(TICKET_TYPEHASH, account, tier, expires)))
        );
    }

    /// Store a signed tier for msg.sender: a ticket is bound to the account it was signed for.
    function applyTicket(uint8 tier, uint64 expires, bytes calldata sig) external {
        if (tier > 2) revert BadTier();
        if (expires <= block.timestamp || expires > block.timestamp + MAX_TICKET_SECONDS) revert BadExpiry();
        if (_recover(ticketDigest(msg.sender, tier, expires), sig) != signer) revert BadSignature();
        tickets[msg.sender] = Ticket(tier, expires);
        emit TicketApplied(msg.sender, tier, expires);
    }

    /// The account's entry fee in basis points right now.
    function entryBps(address account) external view returns (uint16) {
        Ticket memory t = tickets[account];
        if (t.expires <= block.timestamp) return BASE_BPS;
        return t.tier == 2 ? WHALE_BPS : t.tier == 1 ? HOLDER_BPS : BASE_BPS;
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address a) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) revert BadSignature();
        a = ecrecover(digest, v, r, s);
        if (a == address(0)) revert BadSignature();
    }
}
