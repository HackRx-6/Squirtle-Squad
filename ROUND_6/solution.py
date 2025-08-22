def check_almost_equal(s, pattern):
    n = len(s)
    m = len(pattern)
    for i in range(n - m + 1):
        diff = 0
        for j in range(m):
            if s[i + j] != pattern[j]:
                diff += 1
                if diff > 1:
                    break
        if diff <= 1:
            return i
    return -1

if __name__ == "__main__":
    tests = [
        ("abcdefg", "bcdffg"),
        ("ababbababa", "bacaba"),
    ]
    for s, p in tests:
        print(check_almost_equal(s, p))
