def almost_equal_substring(s: str, pattern: str) -> int:
    n, m = len(s), len(pattern)
    if m > n:
        return -1
    for i in range(n - m + 1):
        diff = 0
        for j in range(m):
            if s[i+j] != pattern[j]:
                diff += 1
                if diff > 1:
                    break
        if diff <= 1:
            return i
    return -1

if __name__ == "__main__":
    tests = [("abcdefg", "bcdffg"), ("ababbababa", "bacaba")]
    results = []
    for s, p in tests:
        res = almost_equal_substring(s, p)
        results.append(res)
    print(f"ANSWER 1: {results[0]}")
    print(f"ANSWER 2: {results[1]}")
