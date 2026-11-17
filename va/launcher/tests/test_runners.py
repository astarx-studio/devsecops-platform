import csv

from app import runners

HEADER = ["id", "fqdn/ip", "port", "severity", "finding", "cve", "cwe"]
ROWS = [
    ["engine_problem", "/1.2.3.4", "443", "WARN", "No engine", "", ""],
    ["cert_fingerprintSHA256", "q/1.2.3.4", "443", "INFO", "abc", "", ""],
    ["TLS1_3", "q/1.2.3.4", "443", "OK", "offered", "", ""],
    ["TLS1", "q/1.2.3.4", "443", "LOW", "offered (deprecated)", "", ""],
    ["cipher-tls1_xc009", "q/1.2.3.4", "443", "LOW", "TLSv1   xc009   ECDHE-ECDSA-AES128-SHA", "", ""],
    ["cipher-tls1_2_xc023", "q/1.2.3.4", "443", "MEDIUM", "TLSv1.2   xc023   ECDHE-ECDSA-AES128-SHA256", "", ""],
    ["BREACH", "q/1.2.3.4", "443", "MEDIUM", "potentially VULNERABLE", "CVE-2013-3587", "CWE-310"],
    ["overall_grade", "q/1.2.3.4", "443", "MEDIUM", "B", "", ""],
]


def test_testssl_filter(tmp_path):
    src, dst = tmp_path / "in.csv", tmp_path / "out.csv"
    with src.open("w", newline="") as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_ALL)
        w.writerow(HEADER)
        w.writerows(ROWS)
    kept, grade = runners.filter_testssl(src, dst)
    rows = list(csv.DictReader(dst.open(newline="")))
    assert grade == "B" and kept == 3 == len(rows)
    by_id = {r["id"]: r for r in rows}
    assert set(by_id) == {"TLS1", "BREACH", "weak_ciphers_offered"}
    assert by_id["weak_ciphers_offered"]["severity"] == "MEDIUM"
    assert by_id["weak_ciphers_offered"]["finding"].startswith("2 weak cipher suites offered: TLSv1 xc009")
    assert list(rows[0].keys()) == HEADER
