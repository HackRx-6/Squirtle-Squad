def almost_equal_index(s, pattern):
    n, m = len(s), len(pattern)
    if m > n:
        return -1
    for i in range(n - m + 1):
        diff = 0
        for a, b in zip(s[i:i+m], pattern):
            if a != b:
                diff += 1
                if diff > 1:
                    break
        if diff <= 1:
            return i
    return -1

if __name__ == "__main__":
    tests = [("abcdefg", "bcdffg"), ("ababbababa", "bacaba")]
    for s, p in tests:
        print(almost_equal_index(s, p))
