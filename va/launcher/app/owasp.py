"""CWE -> OWASP Top 10 (2021) and OWASP API Security Top 10 (2023).

The web mapping follows the CWE lists OWASP publishes per category (most common
members). The API mapping is this project's own, since OWASP publishes no CWE list
for it; it is a guide for grouping, not an official classification."""
from __future__ import annotations

TOP10_2021: dict[str, tuple[str, set[int]]] = {
    "A01": ("Broken Access Control", {22, 23, 35, 59, 200, 201, 219, 264, 275, 276, 284, 285, 352, 359, 377, 402,
                                      425, 441, 497, 538, 540, 548, 552, 566, 601, 639, 651, 668, 706, 862, 863,
                                      913, 922, 1275}),
    "A02": ("Cryptographic Failures", {261, 296, 310, 319, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331,
                                       335, 336, 337, 338, 340, 347, 523, 720, 757, 759, 760, 780, 818, 916, 311,
                                       312, 295, 614}),
    "A03": ("Injection", {20, 74, 75, 77, 78, 79, 80, 83, 87, 88, 89, 90, 91, 93, 94, 95, 96, 97, 98, 99, 100, 113,
                          116, 138, 184, 470, 471, 564, 610, 643, 644, 652, 917}),
    "A04": ("Insecure Design", {73, 183, 209, 213, 235, 256, 257, 266, 269, 280, 311, 312, 313, 316, 419, 430, 434,
                                444, 451, 472, 501, 522, 525, 539, 579, 598, 602, 642, 646, 650, 653, 656, 657, 799,
                                807, 840, 841, 927, 1021, 1173}),
    "A05": ("Security Misconfiguration", {2, 11, 13, 15, 16, 260, 315, 520, 526, 537, 541, 547, 611, 614, 693, 756,
                                          776, 942, 1004, 1032, 1174, 933, 1021, 525, 524}),
    "A06": ("Vulnerable and Outdated Components", {937, 1035, 1104, 1395}),
    "A07": ("Identification and Authentication Failures", {255, 259, 287, 288, 290, 294, 295, 297, 300, 302, 304,
                                                           306, 307, 346, 384, 521, 613, 620, 640, 798, 940, 1216}),
    "A08": ("Software and Data Integrity Failures", {345, 353, 426, 494, 502, 565, 784, 829, 830, 915}),
    "A09": ("Security Logging and Monitoring Failures", {117, 223, 532, 778}),
    "A10": ("Server-Side Request Forgery", {918}),
}

API_TOP10_2023: dict[str, tuple[str, set[int]]] = {
    "API1": ("Broken Object Level Authorization", {639, 284, 285, 566}),
    "API2": ("Broken Authentication", {287, 288, 290, 294, 306, 307, 384, 521, 613, 798, 347, 345}),
    "API3": ("Broken Object Property Level Authorization", {213, 915, 200, 201}),
    "API4": ("Unrestricted Resource Consumption", {770, 400, 799, 1333, 409}),
    "API5": ("Broken Function Level Authorization", {862, 863, 269, 425}),
    "API6": ("Unrestricted Access to Sensitive Business Flows", {840, 841}),
    "API7": ("Server Side Request Forgery", {918}),
    "API8": ("Security Misconfiguration", {2, 16, 209, 319, 388, 444, 489, 526, 537, 548, 611, 614, 693, 942, 1004,
                                           295, 326, 327, 933, 1021}),
    "API9": ("Improper Inventory Management", {1059, 1053}),
    "API10": ("Unsafe Consumption of APIs", {20, 502, 829, 346}),
}


def top10(cwe: int | None, has_cve: bool = False) -> str | None:
    """First matching category; a finding that is a known CVE in a component is A06."""
    if has_cve:
        return "A06"
    if not cwe:
        return None
    for key, (_, cwes) in TOP10_2021.items():
        if cwe in cwes:
            return key
    return None


def api_top10(cwe: int | None) -> str | None:
    if not cwe:
        return None
    for key, (_, cwes) in API_TOP10_2023.items():
        if cwe in cwes:
            return key
    return None
