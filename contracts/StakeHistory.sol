// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Cumulative net deposits, queried strictly before a settlement cutoff.
/// Equal block timestamps coalesce. Settlement/claims never scan all deposits.
library StakeHistory {
    struct Amounts { uint256 a; uint256 b; uint256 copiedA; uint256 copiedB; }
    struct Checkpoint { uint256 at; Amounts amounts; }
    function record(Checkpoint[] storage history, Amounts memory amounts) internal {
        uint256 n = history.length;
        if (n != 0 && history[n - 1].at == block.timestamp) history[n - 1].amounts = amounts;
        else history.push(Checkpoint(block.timestamp, amounts));
    }
    function before(Checkpoint[] storage history, uint256 cutoff) internal view returns (Amounts memory) {
        uint256 hi = history.length;
        if (hi == 0) return Amounts(0, 0, 0, 0);
        if (cutoff == 0) return history[hi - 1].amounts;
        uint256 lo;
        while (lo < hi) {
            uint256 mid = lo + (hi - lo) / 2;
            if (history[mid].at < cutoff) lo = mid + 1;
            else hi = mid;
        }
        return lo == 0 ? Amounts(0, 0, 0, 0) : history[lo - 1].amounts;
    }
}
