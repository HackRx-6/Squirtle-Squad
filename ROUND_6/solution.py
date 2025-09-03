def find_almost_equal_substring(s: str, pattern: str) -> int:
    if len(s) < len(pattern):
        return -1
        
    def is_almost_equal(str1: str, str2: str) -> bool:
        if len(str1) != len(str2):
            return False
        diff_count = 0
        for c1, c2 in zip(str1, str2):
            if c1 != c2:
                diff_count += 1
            if diff_count > 1:
                return False
        return True
    
    for i in range(len(s) - len(pattern) + 1):
        substring = s[i:i + len(pattern)]
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