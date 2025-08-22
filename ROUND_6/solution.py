def find_almost_equal_index(s, pattern):
    n, m = len(s), len(pattern)
    if m > n:
        return -1
    for i in range(n - m + 1):
        mismatches = 0
        for a, b in zip(s[i:i+m], pattern):
            if a != b:
                mismatches += 1
                if mismatches > 1:
                    break
        if mismatches <= 1:
            return i
    return -1

if __name__ == "__main__":
    cases = [("abcdefg", "bcdffg"), ("ababbababa", "bacaba")]
    for idx, (s, p) in enumerate(cases, 1):
        print(f"ANSWER {idx}: {find_almost_equal_index(s, p)}")
