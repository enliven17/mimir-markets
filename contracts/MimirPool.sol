// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
 *     MIN_STAKE; the owner (the arbiter, a multisig in production) then rules.
 *     The bond comes back if the ruling changes the verdict and goes to the
 *     platform otherwise. An undisputed proposal is finalized by anyone.
 *   - Escape hatch: RESOLUTION_GRACE_SECONDS after the deadline (or after the
 *     dispute), anyone can refund the market in full. From that moment the
 *     oracle and the arbiter can no longer rule, so the outcome depends on the
 *     clock, not on transaction order. An unruled dispute's bond goes to the
 *     platform (back to the disputer only if there is no platform recipient).
 *   - Payout: a winner gets their stake back plus a pro-rata share of the
 *     losing side, rounded down (dust stays in the contract, so payouts never
 *     exceed the pot). The platform fee is a share of profit only, frozen at
 *     creation. If either side is empty, or on DRAW / UNRESOLVABLE, everyone
 *     is refunded in full, with no fee.
 *   - Settlement is O(1): it records the outcome. Each staker is then paid by
 *     claim(id), or by anyone through claimFor(id, user) (the app pushing to
 *     smart accounts). Pushes carry PUSH_GAS; a refused push is parked for
 *     withdraw(). Implied odds come from sideTotals(id).
 *   - Ownership, oracle and fee changes are timelocked. Pause stops new markets
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
    uint256 public constant MIN_STAKE = 2e18;
    /// No new stakes in the final LOCK_SECONDS before the deadline (anti-sniping).
    uint256 public constant LOCK_SECONDS = 60;
    /// No policy may take more than 10% of a winner's profit.
    uint16  public constant MAX_FEE_BPS = 1_000;
    /// Delay on fee, oracle and ownership changes.
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
        uint16  feeBps;       // frozen at creation
        address feeRecipient; // frozen at creation
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

    uint16  public feeBps;
    address public feeRecipient;
    uint16  public pendingFeeBps;
    address public pendingFeeRecipient;
    uint256 public pendingFeeEta;

    /// Seconds a proposal stays disputable. 0 settles on the oracle's word.
    uint256 public immutable disputeWindow;

    uint256 private _lock = 1;

    // ── Events ────────────────────────────────────────────────────────────────
    event MarketCreated(uint256 indexed id, address indexed creator, uint256 deadline, string category);
    event Staked(uint256 indexed id, address indexed user, uint8 side, uint256 amount);
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
    event FeePolicyQueued(uint16 feeBps, address recipient, uint256 eta);
    event FeePolicyCancelled();
    event FeePolicyUpdated(uint16 feeBps, address recipient);
    event Paused(bool paused);

    // ── Errors ────────────────────────────────────────────────────────────────
    error NotOwner();
    error NotOracle();
    error NotPendingOwner();
    error IsPaused();
    error Reentrant();
    error ZeroAddress();
    error FeeTooHigh();
    error NoFeeRecipient();
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
    constructor(address _oracle, uint16 _feeBps, address _feeRecipient, uint256 _disputeWindow) {
        if (_oracle == address(0)) revert ZeroAddress();
        if (_disputeWindow > MAX_DISPUTE_WINDOW) revert DisputeWindowTooLong();
        _validateFee(_feeBps, _feeRecipient);
        disputeWindow = _disputeWindow;
        owner = msg.sender;
        oracle = _oracle;
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
        emit OwnershipTransferred(address(0), msg.sender);
        emit OracleChanged(address(0), _oracle);
        emit FeePolicyUpdated(_feeBps, _feeRecipient);
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

    function _validateFee(uint16 bps, address recipient) internal pure {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        if (bps != 0 && recipient == address(0)) revert NoFeeRecipient();
    }

    function queueFeePolicy(uint16 bps, address recipient) external onlyOwner {
        _validateFee(bps, recipient);
        pendingFeeBps = bps;
        pendingFeeRecipient = recipient;
        pendingFeeEta = block.timestamp + TIMELOCK_SECONDS;
        emit FeePolicyQueued(bps, recipient, pendingFeeEta);
    }

    function cancelFeePolicy() external onlyOwner {
        if (pendingFeeEta == 0) revert NothingQueued();
        pendingFeeEta = 0;
        emit FeePolicyCancelled();
    }

    function executeFeePolicy() external {
        if (pendingFeeEta == 0) revert NothingQueued();
        if (block.timestamp < pendingFeeEta) revert Timelocked();
        feeBps = pendingFeeBps;
        feeRecipient = pendingFeeRecipient;
        pendingFeeEta = 0;
        emit FeePolicyUpdated(feeBps, feeRecipient);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    // ── Markets and stakes ────────────────────────────────────────────────────
    /// Open a market with msg.value staked on `side` (SIDE_A or SIDE_B).
    function createMarket(
        string calldata question,
        string calldata labelA,
        string calldata labelB,
        string calldata resolutionUrl,
        string calldata category,
        uint256 deadline,
        uint8 side
    ) external payable whenNotPaused nonReentrant returns (uint256 id) {
        if (bytes(question).length == 0) revert EmptyQuestion();
        if (deadline < block.timestamp + LOCK_SECONDS || deadline > type(uint64).max) revert BadDeadline();
        id = ++marketCount;
        Market storage m = _markets[id];
        m.creator = msg.sender;
        m.deadline = uint64(deadline);
        m.createdAt = uint64(block.timestamp);
        m.feeBps = feeBps;
        m.feeRecipient = feeRecipient;
        m.question = question;
        m.labelA = labelA;
        m.labelB = labelB;
        m.resolutionUrl = resolutionUrl;
        m.category = category;
        emit MarketCreated(id, msg.sender, deadline, category);
        _addStake(id, m, side);
    }

    /// Stake msg.value on `side`. Repeated stakes add up.
    function stake(uint256 id, uint8 side) external payable whenNotPaused nonReentrant {
        Market storage m = _markets[id];
        if (m.creator == address(0)) revert NoMarket();
        if (m.state != ST_OPEN) revert NotOpen();
        if (block.timestamp + LOCK_SECONDS > m.deadline) revert BettingClosed();
        _addStake(id, m, side);
    }

    function _addStake(uint256 id, Market storage m, uint8 side) internal {
        if (msg.value < MIN_STAKE) revert StakeTooSmall();
        if (side == SIDE_A) {
            stakeA[id][msg.sender] += msg.value;
            m.totalA += msg.value;
        } else if (side == SIDE_B) {
            stakeB[id][msg.sender] += msg.value;
            m.totalB += msg.value;
        } else {
            revert BadSide();
        }
        emit Staked(id, msg.sender, side, msg.value);
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

    /// A participant escalates the proposal to the arbiter with a MIN_STAKE bond.
    function dispute(uint256 id) external payable nonReentrant {
        Market storage m = _markets[id];
        if (m.state != ST_PROPOSED || m.creator == address(0)) revert NotProposed();
        if (block.timestamp >= m.proposedAt + disputeWindow) revert WindowClosed();
        if (stakeA[id][msg.sender] == 0 && stakeB[id][msg.sender] == 0) revert NotParticipant();
        if (msg.value != MIN_STAKE) revert WrongBond();
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
        address platform = m.feeRecipient;
        if (returnIt || platform == address(0)) {
            _push(m.disputer, bond);
        } else {
            accruedFees[platform] += bond;
            lifetimeFeesAccrued += bond;
            emit FeeAccrued(id, platform, bond);
        }
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

    function _fee(Market storage m, address user, uint256 profit) internal view returns (uint256) {
        if (profit == 0 || m.feeBps == 0 || m.feeRecipient == user) return 0;
        return (profit * m.feeBps) / 10_000;
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
        uint256 fee = _fee(m, user, profit);
        if (fee != 0) {
            accruedFees[m.feeRecipient] += fee;
            lifetimeFeesAccrued += fee;
            emit FeeAccrued(id, m.feeRecipient, fee);
        }
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
        uint256 totalB,
        uint16  marketFeeBps,
        address marketFeeRecipient
    ) {
        Market storage m = _markets[id];
        return (m.creator, m.deadline, m.createdAt, m.state, m.outcome, m.totalA, m.totalB, m.feeBps, m.feeRecipient);
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

    /// What claimFor would pay `user` now (net) and the fee it would take. 0 if
    /// unresolved, already claimed or nothing owed.
    function claimable(uint256 id, address user) external view returns (uint256 payout, uint256 fee) {
        Market storage m = _markets[id];
        if (m.state != ST_RESOLVED || claimed[id][user]) return (0, 0);
        (uint256 gross, uint256 profit) = _owed(id, m, user);
        fee = _fee(m, user, profit);
        payout = gross - fee;
    }

    receive() external payable {
        revert DirectTransfer();
    }
}
