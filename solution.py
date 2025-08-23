def find_almost_equal(s, p):
    n, m = len(s), len(p)
    for i in range(n - m + 1):
        diff = 0
        for a, b in zip(s[i:i+m], p):
            if a != b:
                diff += 1
                if diff > 1:
                    break
        if diff <= 1:
            return i
    return -1

if __name__ == "__main__":
    tests = [("abcdefg","bcdffg"),("ababbababa","bacaba")]
    for s,p in tests:
        print(find_almost_equal(s,p))
