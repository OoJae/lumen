// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC7857} from '../interfaces/IERC7857.sol';
import {IERC7857Metadata} from '../interfaces/IERC7857Metadata.sol';

/// @dev Test-only helper so the TS suite can assert supportsInterface against
///      the compiler's own interfaceId rather than a hand-XORed constant.
///      Never deployed to a live network.
contract InterfaceIds {
    function erc7857() external pure returns (bytes4) {
        return type(IERC7857).interfaceId;
    }

    function erc7857Metadata() external pure returns (bytes4) {
        return type(IERC7857Metadata).interfaceId;
    }
}
