def find_almost_equal_substring(s: str, pattern: str) -> int:
    def is_almost_equal(s1: str, s2: str) -> bool:
        if len(s1) != len(s2):
            return False
        differences = 0
        for c1, c2 in zip(s1, s2):
            if c1 != c2:
                differences += 1
            if differences > 1:
                return False
        return True
    
    n, m = len(s), len(pattern)
    for i in range(n - m + 1):
        substring = s[i:i + m]
        if is_almost_equal(substring, pattern):
            return i
    return -1

# Test cases
s1 = "abcdefg"
pattern1 = "bcdffg"
print(f"Test 1: {find_almost_equal_substring(s1, pattern1)}")

s2 = "ababbababa"
pattern2 = "bacaba"
print(f"Test 2: {find_almost_equal_substring(s2, pattern2)}")