// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Test stand-in for MimirFees: the same entry-fee rate for everyone (0 isolates mechanics from fees).
contract FlatFees {
    uint16 public immutable bps;

    constructor(uint16 _bps) {
        bps = _bps;
    }

    function entryBps(address) external view returns (uint16) {
        return bps;
    }
}
