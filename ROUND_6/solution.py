def find_almost_equal(s, p):
    n=len(s)
    m=len(p)
    for i in range(n-m+1):
        sub=s[i:i+m]
        diff=0
        for a,b in zip(sub,p):
            if a!=b:
                diff+=1
                if diff>1:
                    break
        if diff<=1:
            return i
    return -1

if __name__=="__main__":
    cases=[("abcdefg","bcdffg"),("ababbababa","bacaba")]
    for s,p in cases:
        print(find_almost_equal(s,p))
