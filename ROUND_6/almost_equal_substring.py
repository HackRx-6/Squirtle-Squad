def find_almost_equal_substring(s: str, pattern: str) -> int:
    n, m = len(s), len(pattern)
    if m > n:
        return -1
    
    for i in range(n - m + 1):
        substring = s[i:i+m]
        diff_count = 0
        for j in range(m):
            if substring[j] != pattern[j]:
                diff_count += 1
            if diff_count > 1:
                break
        if diff_count <= 1:
            return i
    return -1

# Test the function with provided inputs
test_cases = [
    ("abcdefg", "bcdffg"),
    ("ababbababa", "bacaba")
]

for s, pattern in test_cases:
    result = find_almost_equal_substring(s, pattern)
    print(f"s: {s}, pattern: {pattern}, result: {result}")