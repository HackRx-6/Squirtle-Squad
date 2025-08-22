def first_almost_index(s, pattern):
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
    # Testcase 1
    s1 = "abcdefg"
    p1 = "bcdffg"
    res1 = first_almost_index(s1, p1)

    # Testcase 2
    s2 = "ababbababa"
    p2 = "bacaba"
    res2 = first_almost_index(s2, p2)

    print(f"ANSWER 1: {res1}")
    print(f"ANSWER 2: {res2}")
