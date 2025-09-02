def find_almost_equal_substring(s: str, pattern: str) -> int:
    n, m = len(s), len(pattern)
    if m > n:
        return -1
    
    for i in range(n - m + 1):
        substring = s[i:i + m]
        diff_count = 0
        for j in range(m):
            if substring[j] != pattern[j]:
                diff_count += 1
            if diff_count > 1:
                break
        if diff_count <= 1:
            return i
    return -1

# Test cases
if __name__ == "__main__":
    # Test case 1
    s1 = "abcdefg"
    pattern1 = "bcdffg"
    result1 = find_almost_equal_substring(s1, pattern1)
    print(f"Test 1: s={s1}, pattern={pattern1}, result={result1}")
    
    # Test case 2
    s2 = "ababbababa"
    pattern2 = "bacaba"
    result2 = find_almost_equal_substring(s2, pattern2)
    print(f"Test 2: s={s2}, pattern={pattern2}, result={result2}")
