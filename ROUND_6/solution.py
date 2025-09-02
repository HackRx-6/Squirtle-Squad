def find_almost_equal_substring(s: str, pattern: str) -> int:
    if len(s) < len(pattern):
        return -1
    
    for i in range(len(s) - len(pattern) + 1):
        substring = s[i:i + len(pattern)]
        diff_count = 0
        for j in range(len(pattern)):
            if substring[j] != pattern[j]:
                diff_count += 1
            if diff_count > 1:
                break
        if diff_count <= 1:
            return i
    return -1

# Test cases
s1 = "abcdefg"
pattern1 = "bcdffg"
print(f"Test 1: {find_almost_equal_substring(s1, pattern1)}")

s2 = "ababbababa"
pattern2 = "bacaba"
print(f"Test 2: {find_almost_equal_substring(s2, pattern2)}")