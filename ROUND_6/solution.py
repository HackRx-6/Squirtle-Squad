def smallest_almost_equal_index(s, pattern):
    n = len(s)
    m = len(pattern)
    if m > n:
        return -1
    for i in range(n - m + 1):
        mismatches = 0
        for j in range(m):
            if s[i+j] != pattern[j]:
                mismatches += 1
                if mismatches > 1:
                    break
        if mismatches <= 1:
            return i
    return -1

if __name__ == "__main__":
    cases = [
        ("abcdefg", "bcdffg"),
        ("ababbababa", "bacaba"),
    ]
    for s, p in cases:
        idx = smallest_almost_equal_index(s, p)
        print(idx)
