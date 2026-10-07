// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// The entry-fee rate per account (contracts/MimirFees.sol).
interface IMimirFees {
    function entryBps(address account) external view returns (uint16);
}

/**
 * MimirPool: two-sided pool prediction markets, settled by an AI oracle.
 * Native-USDC only (Arc: USDC is the gas token, 18 decimals, stakes are msg.value).
 *
 * Model
 *   - A market has two sides, A and B (YES / NO). The creator opens it with a
 *     stake on one side. Anyone, the creator included, can then stake on either
 *     side until LOCK_SECONDS before the deadline. Stakes by the same address
 *     add up per side.
 *   - After the deadline the oracle proposes A, B, DRAW or UNRESOLVABLE. A
 *     participant can dispute within the dispute window by posting a bond of
 *     DISPUTE_BOND; the owner (the arbiter, a multisig in production) then rules.
 *     The bond comes back if the ruling changes the verdict and goes to the
 *     platform otherwise. An undisputed proposal is finalized by anyone.
 *   - Escape hatch: RESOLUTION_GRACE_SECONDS after the deadline (or after the
 *     dispute), anyone can refund the market in full. From that moment the
 *     oracle and the arbiter can no longer rule, so the outcome depends on the
 *     clock, not on transaction order. An unruled dispute's bond goes to the
 *     platform.
 *   - Fees: every stake (the creator's opening one included) pays an entry
 *     fee, MimirFees.entryBps(msg.sender) of msg.value (0.5% by default, less
 *     for $MIMIR holders with a signed ticket); the rest is staked. The entry
 *     fee is earned and kept on refunds. Winnings pay no fee, except copy
 *     trades: a stake made with a `referrer` (the basket creator it copies)
 *     pays REFERRER_FEE_BPS of its profit to the referrer and COPY_FEE_BPS to
 *     the platform.
 *   - Payout: a winner gets their stake back plus a pro-rata share of the
 *     losing side, rounded down (dust stays in the contract, so payouts never
 *     exceed the pot). If either side is empty, or on DRAW / UNRESOLVABLE,
 *     everyone gets their stake back.
 *   - Settlement is O(1): it records the outcome. Each staker is then paid by
 *     claim(id), or by anyone through claimFor(id, user) (the app pushing to
 *     smart accounts). Pushes carry PUSH_GAS; a refused push is parked for
 *     withdraw(). Implied odds come from sideTotals(id).
 *   - Ownership, oracle and fee-recipient changes are timelocked. Pause stops new markets
 *     and stakes, never settlement, refunds, claims or withdrawals.
 */
contract MimirPool {
    // ── Constants ─────────────────────────────────────────────────────────────
    uint8 public constant ST_OPEN     = 0;
    uint8 public constant ST_PROPOSED = 1;
    uint8 public constant ST_DISPUTED = 2;
    uint8 public constant ST_RESOLVED = 3;

    uint8 public constant SIDE_A       = 1;
    uint8 public constant SIDE_B       = 2;
    uint8 public constant DRAW         = 3;
    uint8 public constant UNRESOLVABLE = 4;

    /// 2 USDC (native, 18 decimals): minimum stake and the dispute bond.
    /// Smallest stake (gross), fixed at deploy (0.01 to 100 USDC).
    uint256 public immutable MIN_STAKE;
    uint256 public constant MIN_STAKE_FLOOR = 1e16;
    uint256 public constant MIN_STAKE_CEILING = 100e18;
    /// The dispute bond, independent of the stake minimum so disputes stay costly to spam.
    uint256 public constant DISPUTE_BOND = 2e18;
    /// No new stakes in the final LOCK_SECONDS before the deadline (anti-sniping).
    uint256 public constant LOCK_SECONDS = 60;
    /// Copy trades: the referrer's share of a winning stake's profit, and the platform's.
    uint16  public constant REFERRER_FEE_BPS = 100;
    uint16  public constant COPY_FEE_BPS = 100;
    /// Delay on fee-recipient, oracle and ownership changes.
    uint256 public constant TIMELOCK_SECONDS = 2 days;
    uint256 public constant RESOLUTION_GRACE_SECONDS = 7 days;
    uint256 public constant PUSH_GAS = 50_000;
    uint256 public constant MAX_DISPUTE_WINDOW = 7 days;

    // ── Storage ───────────────────────────────────────────────────────────────
    struct Market {
        address creator;
        uint64  deadline;
        uint64  createdAt;
        uint8   state;
        uint8   outcome;      // final, once RESOLVED
        uint8   proposed;     // the oracle's proposal
        uint64  proposedAt;
        uint64  disputedAt;
        address disputer;
        uint256 bond;
        uint256 totalA;
        uint256 totalB;
        bytes32 evidenceHash;
        string  question;
        string  labelA;
        string  labelB;
        string  resolutionUrl;
        string  category;
        string  summary;
    }

    mapping(uint256 => Market) internal _markets;
    mapping(uint256 => mapping(address => uint256)) public stakeA;
    mapping(uint256 => mapping(address => uint256)) public stakeB;
    mapping(uint256 => mapping(address => bool)) public claimed;
    /// The referrer (copied basket's creator) of a user's stakes in a market: the first non-zero one named.
    mapping(uint256 => mapping(address => address)) public referrerOf;
    /// Payouts whose push was refused, pulled with withdraw().
    mapping(address => uint256) public pendingWithdrawals;
    /// Fees and forfeited bonds owed to a recipient, pulled with claimFees().
    mapping(address => uint256) public accruedFees;

    uint256 public marketCount;
    uint256 public lifetimeFeesAccrued;
    uint256 public lifetimeFeesClaimed;

    address public owner;
    address public pendingOwner;
    uint256 public pendingOwnerEta;
    address public oracle;
    address public pendingOracle;
    uint256 public pendingOracleEta;
    bool    public paused;

    /// Entry-fee rates per account.
    IMimirFees public immutable fees;
    /// Receives entry fees, the copy-trade platform share and forfeited bonds.
    address public feeRecipient;
    address public pendingFeeRecipient;
    uint256 public pendingFeeEta;

    /// Seconds a proposal stays disputable. 0 settles on the oracle's word.
    uint256 public immutable disputeWindow;

    uint256 private _lock = 1;

    // ── Events ────────────────────────────────────────────────────────────────
    event MarketCreated(uint256 indexed id, address indexed creator, uint256 deadline, string category);
    /// `amount` is what was staked, after the entry fee.
    event Staked(uint256 indexed id, address indexed user, uint8 side, uint256 amount);
    event ReferrerSet(uint256 indexed id, address indexed user, address indexed referrer);
    event ResolutionProposed(uint256 indexed id, uint8 outcome, bytes32 evidenceHash, uint256 disputableUntil);
    event ResolutionDisputed(uint256 indexed id, address indexed disputer, uint256 bond);
    event DisputeResolved(uint256 indexed id, uint8 outcome, bool disputerRight);
    event MarketResolved(uint256 indexed id, uint8 outcome, string summary, bytes32 evidenceHash);
    event MarketExpiredRefund(uint256 indexed id, address indexed caller);
    event Claimed(uint256 indexed id, address indexed user, uint256 paid, uint256 fee);
    event FeeAccrued(uint256 indexed id, address indexed recipient, uint256 amount);
    event FeeClaimed(address indexed recipient, address indexed to, uint256 amount);
    event WithdrawalPending(address indexed to, uint256 amount);
    event Withdrawal(address indexed account, address indexed to, uint256 amount);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner, uint256 eta);
    event OwnershipTransferCancelled(address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OracleChangeQueued(address indexed next, uint256 eta);
    event OracleChangeCancelled(address indexed next);
    event OracleChanged(address indexed previous, address indexed next);
    event FeeRecipientQueued(address indexed next, uint256 eta);
    event FeeRecipientCancelled(address indexed next);
    event FeeRecipientChanged(address indexed previous, address indexed next);
    event Paused(bool paused);

    // ── Errors ────────────────────────────────────────────────────────────────
    error BadMinStake();
    error NotOwner();
    error NotOracle();
    error NotPendingOwner();
    error IsPaused();
    error Reentrant();
    error ZeroAddress();
    error NoCode();
    error NothingQueued();
    error Timelocked();
    error DisputeWindowTooLong();
    error EmptyQuestion();
    error BadDeadline();
    error BadSide();
    error StakeTooSmall();
    error NoMarket();
    error NotOpen();
    error BettingClosed();
    error NotExpired();
    error GraceOver();
    error GraceNotOver();
    error NotProposed();
    error WindowOpen();
    error WindowClosed();
    error NotParticipant();
    error WrongBond();
    error NotDisputed();
    error NotResolved();
    error AlreadyClaimed();
    error NothingToClaim();
    error NothingToWithdraw();
    error TransferFailed();
    error DirectTransfer();

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address _oracle, address _feeRecipient, IMimirFees _fees, uint256 _disputeWindow, uint256 _minStake) {
        if (_oracle == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        if (_minStake < MIN_STAKE_FLOOR || _minStake > MIN_STAKE_CEILING) revert BadMinStake();
        MIN_STAKE = _minStake;
        if (address(_fees).code.length == 0) revert NoCode();
        if (_disputeWindow > MAX_DISPUTE_WINDOW) revert DisputeWindowTooLong();
        disputeWindow = _disputeWindow;
        owner = msg.sender;
        oracle = _oracle;
        fees = _fees;
        feeRecipient = _feeRecipient;
        emit OwnershipTransferred(address(0), msg.sender);
        emit OracleChanged(address(0), _oracle);
        emit FeeRecipientChanged(address(0), _feeRecipient);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    /// Two steps and a timelock: the new owner accepts no earlier than TIMELOCK_SECONDS.
    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        pendingOwner = next;
        pendingOwnerEta = block.timestamp + TIMELOCK_SECONDS;
        emit OwnershipTransferStarted(owner, next, pendingOwnerEta);
    }

    function cancelOwnershipTransfer() external onlyOwner {
        if (pendingOwnerEta == 0) revert NothingQueued();
        emit OwnershipTransferCancelled(pendingOwner);
        pendingOwner = address(0);
        pendingOwnerEta = 0;
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        if (block.timestamp < pendingOwnerEta) revert Timelocked();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
        pendingOwnerEta = 0;
    }

    function queueOracle(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        pendingOracle = next;
        pendingOracleEta = block.timestamp + TIMELOCK_SECONDS;
        emit OracleChangeQueued(next, pendingOracleEta);
    }

    function cancelOracle() external onlyOwner {
        if (pendingOracleEta == 0) revert NothingQueued();
        emit OracleChangeCancelled(pendingOracle);
        pendingOracle = address(0);
        pendingOracleEta = 0;
    }

    /// Permissionless once due, so a queued change cannot be quietly withheld.
    function executeOracle() external {
        if (pendingOracleEta == 0) revert NothingQueued();
        if (block.timestamp < pendingOracleEta) revert Timelocked();
        emit OracleChanged(oracle, pendingOracle);
        oracle = pendingOracle;
        pendingOracle = address(0);
        pendingOracleEta = 0;
    }

    function queueFeeRecipient(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        pendingFeeRecipient = next;
        pendingFeeEta = block.timestamp + TIMELOCK_SECONDS;
        emit FeeRecipientQueued(next, pendingFeeEta);
    }

    function cancelFeeRecipient() external onlyOwner {
        if (pendingFeeEta == 0) revert NothingQueued();
        emit FeeRecipientCancelled(pendingFeeRecipient);
        pendingFeeRecipient = address(0);
        pendingFeeEta = 0;
    }

    function executeFeeRecipient() external {
        if (pendingFeeEta == 0) revert NothingQueued();
        if (block.timestamp < pendingFeeEta) revert Timelocked();
        emit FeeRecipientChanged(feeRecipient, pendingFeeRecipient);
        feeRecipient = pendingFeeRecipient;
        pendingFeeRecipient = address(0);
        pendingFeeEta = 0;
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    // ── Markets and stakes ────────────────────────────────────────────────────
    /// Open a market with msg.value (less the entry fee) staked on `side` (SIDE_A or SIDE_B).
    /// `referrer`: the basket creator this stake copies, or address(0).
    function createMarket(
        string calldata question,
        string calldata labelA,
        string calldata labelB,
        string calldata resolutionUrl,
        string calldata category,
        uint256 deadline,
        uint8 side,
        address referrer
    ) external payable whenNotPaused nonReentrant returns (uint256 id) {
        if (bytes(question).length == 0) revert EmptyQuestion();
        if (deadline < block.timestamp + LOCK_SECONDS || deadline > type(uint64).max) revert BadDeadline();
        id = ++marketCount;
        Market storage m = _markets[id];
        m.creator = msg.sender;
        m.deadline = uint64(deadline);
        m.createdAt = uint64(block.timestamp);
        m.question = question;
        m.labelA = labelA;
        m.labelB = labelB;
        m.resolutionUrl = resolutionUrl;
        m.category = category;
        emit MarketCreated(id, msg.sender, deadline, category);
        _addStake(id, m, side, referrer);
    }

    /// Stake msg.value (less the entry fee) on `side`. Repeated stakes add up.
    function stake(uint256 id, uint8 side, address referrer) external payable whenNotPaused nonReentrant {
        Market storage m = _markets[id];
        if (m.creator == address(0)) revert NoMarket();
        if (m.state != ST_OPEN) revert NotOpen();
        if (block.timestamp + LOCK_SECONDS > m.deadline) revert BettingClosed();
        _addStake(id, m, side, referrer);
    }

    function _addStake(uint256 id, Market storage m, uint8 side, address referrer) internal {
        if (msg.value < MIN_STAKE) revert StakeTooSmall();
        uint256 fee = (msg.value * fees.entryBps(msg.sender)) / 10_000;
        if (fee != 0) _accrue(id, feeRecipient, fee);
        uint256 net = msg.value - fee;
        if (side == SIDE_A) {
            stakeA[id][msg.sender] += net;
            m.totalA += net;
        } else if (side == SIDE_B) {
            stakeB[id][msg.sender] += net;
            m.totalB += net;
        } else {
            revert BadSide();
        }
        // No allowlist: a passkey account signs a hash, so a compromised front end
        // could already make it do anything; a list would only guard this 1%.
        if (referrer != address(0) && referrerOf[id][msg.sender] == address(0)) {
            referrerOf[id][msg.sender] = referrer;
            emit ReferrerSet(id, msg.sender, referrer);
        }
        emit Staked(id, msg.sender, side, net);
    }

    function _accrue(uint256 id, address to, uint256 amount) internal {
        accruedFees[to] += amount;
        lifetimeFeesAccrued += amount;
        emit FeeAccrued(id, to, amount);
    }

    // ── Resolution ────────────────────────────────────────────────────────────
    function _validOutcome(uint8 outcome) internal pure {
        if (outcome < SIDE_A || outcome > UNRESOLVABLE) revert BadSide();
    }

    /// When refundExpired opens: the grace counted from the deadline, or from the dispute.
    function _refundAt(Market storage m) internal view returns (uint256 start) {
        start = m.deadline;
        if (m.disputedAt > start) start = m.disputedAt;
        start += RESOLUTION_GRACE_SECONDS;
    }

    /// The oracle's verdict: final at once with no dispute window, else a proposal.
    function resolve(uint256 id, uint8 outcome, string calldata summary, bytes32 evidenceHash)
        external
        nonReentrant
    {
        if (msg.sender != oracle) revert NotOracle();
        Market storage m = _markets[id];
        if (m.creator == address(0)) revert NoMarket();
        if (m.state != ST_OPEN) revert NotOpen();
        if (block.timestamp < m.deadline) revert NotExpired();
        if (block.timestamp >= _refundAt(m)) revert GraceOver();
        _validOutcome(outcome);
        if (disputeWindow == 0) {
            _settle(id, m, outcome, summary, evidenceHash);
            return;
        }
        m.state = ST_PROPOSED;
        m.proposed = outcome;
        m.proposedAt = uint64(block.timestamp);
        m.evidenceHash = evidenceHash;
        m.summary = summary;
        emit ResolutionProposed(id, outcome, evidenceHash, block.timestamp + disputeWindow);
    }

    /// A participant escalates the proposal to the arbiter with the DISPUTE_BOND.
    function dispute(uint256 id) external payable nonReentrant {
        Market storage m = _markets[id];
        if (m.state != ST_PROPOSED || m.creator == address(0)) revert NotProposed();
        if (block.timestamp >= m.proposedAt + disputeWindow) revert WindowClosed();
        if (stakeA[id][msg.sender] == 0 && stakeB[id][msg.sender] == 0) revert NotParticipant();
        if (msg.value != DISPUTE_BOND) revert WrongBond();
        m.state = ST_DISPUTED;
        m.disputer = msg.sender;
        m.disputedAt = uint64(block.timestamp);
        m.bond = msg.value;
        emit ResolutionDisputed(id, msg.sender, msg.value);
    }

    /// Anyone settles an undisputed proposal once the window has closed.
    function finalize(uint256 id) external nonReentrant {
        Market storage m = _markets[id];
        if (m.state != ST_PROPOSED || m.creator == address(0)) revert NotProposed();
        if (block.timestamp < m.proposedAt + disputeWindow) revert WindowOpen();
        _settle(id, m, m.proposed, m.summary, m.evidenceHash);
    }

    /// The arbiter's final word on a disputed market.
    function resolveDispute(uint256 id, uint8 outcome, string calldata summary, bytes32 evidenceHash)
        external
        onlyOwner
        nonReentrant
    {
        Market storage m = _markets[id];
        if (m.state != ST_DISPUTED) revert NotDisputed();
        if (block.timestamp >= _refundAt(m)) revert GraceOver();
        _validOutcome(outcome);
        bool disputerRight = outcome != m.proposed;
        emit DisputeResolved(id, outcome, disputerRight);
        // Settled before the bond moves.
        _settle(id, m, outcome, summary, evidenceHash);
        _settleBond(id, m, disputerRight);
    }

    /// Escape hatch: a market nobody settled in time is refunded in full, by anyone.
    function refundExpired(uint256 id) external nonReentrant {
        Market storage m = _markets[id];
        if (m.creator == address(0)) revert NoMarket();
        bool disputed = m.state == ST_DISPUTED;
        if (!disputed && m.state != ST_OPEN) revert NotOpen();
        if (block.timestamp < _refundAt(m)) revert GraceNotOver();
        emit MarketExpiredRefund(id, msg.sender);
        _settle(id, m, UNRESOLVABLE, "Refunded: not resolved within the grace period", bytes32(0));
        // An unruled dispute cannot stall a loss into a free refund.
        if (disputed) _settleBond(id, m, false);
    }

    function _settle(uint256 id, Market storage m, uint8 outcome, string memory summary, bytes32 evidenceHash)
        internal
    {
        m.state = ST_RESOLVED;
        m.outcome = outcome;
        m.summary = summary;
        m.evidenceHash = evidenceHash;
        emit MarketResolved(id, outcome, summary, evidenceHash);
    }

    function _settleBond(uint256 id, Market storage m, bool returnIt) internal {
        uint256 bond = m.bond;
        if (bond == 0) return;
        m.bond = 0;
        if (returnIt) _push(m.disputer, bond);
        else _accrue(id, feeRecipient, bond);
    }

    // ── Claims ────────────────────────────────────────────────────────────────
    /// What `user` is owed from a resolved market: gross = stake back + share of
    /// the losing side; profit = the share alone. Full refund when either side
    /// is empty or on DRAW / UNRESOLVABLE.
    function _owed(uint256 id, Market storage m, address user) internal view returns (uint256 gross, uint256 profit) {
        uint256 a = stakeA[id][user];
        uint256 b = stakeB[id][user];
        uint8 o = m.outcome;
        bool contested = m.totalA != 0 && m.totalB != 0;
        if (contested && o == SIDE_A) {
            profit = (a * m.totalB) / m.totalA;
            gross = a == 0 ? 0 : a + profit;
        } else if (contested && o == SIDE_B) {
            profit = (b * m.totalA) / m.totalB;
            gross = b == 0 ? 0 : b + profit;
        } else {
            gross = a + b;
        }
    }

    /// Copy-trade fees on a winning stake's profit: (to the referrer, to the platform).
    /// Nobody pays themselves: a referrer or fee recipient who is the user waives that leg.
    function _copyFees(uint256 id, address user, uint256 profit) internal view returns (uint256 toRef, uint256 toPlatform) {
        address ref = referrerOf[id][user];
        if (profit == 0 || ref == address(0) || ref == user) return (0, 0);
        toRef = (profit * REFERRER_FEE_BPS) / 10_000;
        if (feeRecipient != user) toPlatform = (profit * COPY_FEE_BPS) / 10_000;
    }

    /// Collect your own payout.
    function claim(uint256 id) external {
        claimFor(id, msg.sender);
    }

    /// Anyone may push a user's payout to them (the app, for smart accounts).
    /// The money only ever goes to `user`; a refused push is parked for withdraw().
    function claimFor(uint256 id, address user) public nonReentrant {
        Market storage m = _markets[id];
        if (m.state != ST_RESOLVED || m.creator == address(0)) revert NotResolved();
        if (claimed[id][user]) revert AlreadyClaimed();
        (uint256 gross, uint256 profit) = _owed(id, m, user);
        if (gross == 0) revert NothingToClaim();
        claimed[id][user] = true;
        (uint256 toRef, uint256 toPlatform) = _copyFees(id, user, profit);
        if (toRef != 0) _accrue(id, referrerOf[id][user], toRef);
        if (toPlatform != 0) _accrue(id, feeRecipient, toPlatform);
        uint256 fee = toRef + toPlatform;
        emit Claimed(id, user, gross - fee, fee);
        _push(user, gross - fee);
    }

    // ── Pull balances ─────────────────────────────────────────────────────────
    function _send(address to, uint256 amount, uint256 gasLimit) internal returns (bool ok) {
        assembly ("memory-safe") {
            ok := call(gasLimit, to, amount, 0, 0, 0, 0)
        }
    }

    function _push(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!_send(to, amount, PUSH_GAS)) {
            pendingWithdrawals[to] += amount;
            emit WithdrawalPending(to, amount);
        }
    }

    function withdraw() external {
        _withdrawTo(msg.sender);
    }

    function withdrawTo(address to) external {
        if (to == address(0)) revert ZeroAddress();
        _withdrawTo(to);
    }

    function _withdrawTo(address to) internal nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        if (!_send(to, amount, gasleft())) revert TransferFailed();
        emit Withdrawal(msg.sender, to, amount);
    }

    function claimFees() external {
        _claimFeesTo(msg.sender);
    }

    function claimFeesTo(address to) external {
        if (to == address(0)) revert ZeroAddress();
        _claimFeesTo(to);
    }

    function _claimFeesTo(address to) internal nonReentrant {
        uint256 amount = accruedFees[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        accruedFees[msg.sender] = 0;
        lifetimeFeesClaimed += amount;
        if (!_send(to, amount, gasleft())) revert TransferFailed();
        emit FeeClaimed(msg.sender, to, amount);
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    function getMarket(uint256 id) external view returns (
        address creator,
        uint256 deadline,
        uint256 createdAt,
        uint8   state,
        uint8   outcome,
        uint256 totalA,
        uint256 totalB
    ) {
        Market storage m = _markets[id];
        return (m.creator, m.deadline, m.createdAt, m.state, m.outcome, m.totalA, m.totalB);
    }

    function getMarketText(uint256 id) external view returns (
        string memory question,
        string memory labelA,
        string memory labelB,
        string memory resolutionUrl,
        string memory category,
        string memory summary
    ) {
        Market storage m = _markets[id];
        return (m.question, m.labelA, m.labelB, m.resolutionUrl, m.category, m.summary);
    }

    function getProposal(uint256 id) external view returns (
        uint8   proposed,
        uint256 proposedAt,
        uint256 disputedAt,
        address disputer,
        uint256 bond,
        bytes32 evidenceHash
    ) {
        Market storage m = _markets[id];
        return (m.proposed, m.proposedAt, m.disputedAt, m.disputer, m.bond, m.evidenceHash);
    }

    /// Pool sizes: implied probability of A is totalA / (totalA + totalB).
    function sideTotals(uint256 id) external view returns (uint256 totalA, uint256 totalB) {
        return (_markets[id].totalA, _markets[id].totalB);
    }

    function stakeOf(uint256 id, address user) external view returns (uint256 onA, uint256 onB) {
        return (stakeA[id][user], stakeB[id][user]);
    }

    /// What claimFor would pay `user` now (net) and the copy fees it would take.
    /// 0 if unresolved, already claimed or nothing owed.
    function claimable(uint256 id, address user) external view returns (uint256 payout, uint256 fee) {
        Market storage m = _markets[id];
        if (m.state != ST_RESOLVED || claimed[id][user]) return (0, 0);
        (uint256 gross, uint256 profit) = _owed(id, m, user);
        (uint256 toRef, uint256 toPlatform) = _copyFees(id, user, profit);
        fee = toRef + toPlatform;
        payout = gross - fee;
    }

    receive() external payable {
        revert DirectTransfer();
    }
}
