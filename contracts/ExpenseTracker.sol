// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Blockchain-Based Expense Tracker
/// @notice Every wallet keeps its own list of expenses. Records are append-only:
///         once added, an expense cannot be edited or removed, so the ledger is
///         tamper-proof.
/// @dev Amounts are whole numbers in the smallest currency unit (paise for INR),
///      so 250.75 rupees is stored as 25075. Blockchain data is public.
contract ExpenseTracker {
    struct Expense {
        uint256 id;
        string description;
        string category;
        uint256 amount; // in paise
        uint256 date; // unix timestamp of when the money was spent
        uint256 recordedAt; // block timestamp when it was added
    }

    uint256 public constant MAX_DESCRIPTION_LENGTH = 100;
    uint256 public constant MAX_CATEGORY_LENGTH = 30;

    mapping(address => Expense[]) private expenses; // expense id = array index + 1
    mapping(address => uint256) private totals;

    event ExpenseAdded(address indexed user, uint256 indexed id, string category, uint256 amount, uint256 date);

    /// @notice Record an expense.
    /// @param amount Amount in paise (must be greater than zero).
    /// @param date When the money was spent (unix seconds); pass 0 for "now".
    /// @return id The expense ID in your ledger (1, 2, 3, ...).
    function addExpense(string calldata description, string calldata category, uint256 amount, uint256 date)
        external
        returns (uint256 id)
    {
        require(bytes(description).length > 0, "Description is required");
        require(bytes(description).length <= MAX_DESCRIPTION_LENGTH, "Description is too long");
        require(bytes(category).length > 0, "Category is required");
        require(bytes(category).length <= MAX_CATEGORY_LENGTH, "Category is too long");
        require(amount > 0, "Amount must be greater than zero");

        uint256 spentAt = date == 0 ? block.timestamp : date;
        require(spentAt <= block.timestamp + 1 days, "Date cannot be in the future");

        Expense[] storage list = expenses[msg.sender];
        id = list.length + 1;
        list.push(
            Expense({
                id: id,
                description: description,
                category: category,
                amount: amount,
                date: spentAt,
                recordedAt: block.timestamp
            })
        );
        totals[msg.sender] += amount;

        emit ExpenseAdded(msg.sender, id, category, amount, spentAt);
    }

    /// @notice All of your expenses, oldest first.
    function getExpenses() external view returns (Expense[] memory) {
        return expenses[msg.sender];
    }

    /// @notice Sum of all your expenses, in paise.
    function getTotal() external view returns (uint256) {
        return totals[msg.sender];
    }

    /// @notice Number of expenses you have recorded.
    function getExpenseCount() external view returns (uint256) {
        return expenses[msg.sender].length;
    }

    /// @notice Sum of your expenses in one category, in paise.
    function getTotalByCategory(string calldata category) external view returns (uint256 sum) {
        Expense[] storage list = expenses[msg.sender];
        bytes32 wanted = keccak256(bytes(category));
        for (uint256 i = 0; i < list.length; i++) {
            if (keccak256(bytes(list[i].category)) == wanted) {
                sum += list[i].amount;
            }
        }
    }
}
