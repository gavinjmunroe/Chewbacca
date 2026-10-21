"""
discovery/enforcement_actions.py — FINRA/SEC enforcement action corpus builder.

Enforcement actions are the most valuable training data for FiduciaryOS:
they represent ground-truth fiduciary violations with expert (SEC/FINRA)
annotations of what went wrong and why it violated the fiduciary duty.

Sources:
  1. SEC Litigation Releases (www.sec.gov/litigation/litreleases)
  2. SEC Administrative Proceedings (investment adviser cases)
  3. FINRA Disciplinary Actions (www.finra.org/rules-guidance/oversight-enforcement)
  4. FINRA AWC (Acceptance, Waiver and Consent) agreements

Each enforcement action is converted to a training pair:
    input:  "Here is a description of an adviser's actions..."
    output: "These actions violate fiduciary duty because... The specific
             violations are: [1] ... [2] ... The appropriate action would
             have been: ..."

Target: 105,000+ violation-explanation pairs (30% of total training corpus).

Usage:
    crawler = EnforcementActionCrawler(output_dir="data/raw/enforcement")
    crawler.crawl_sec_lit_releases(max_releases=3000)
    crawler.crawl_finra_actions(max_actions=5000)
    crawler.build_violation_pairs(input_dir="data/raw/enforcement", output_file="data/processed/violation_pairs.jsonl")
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

import requests
from loguru import logger


@dataclass
class EnforcementAction:
    """A single enforcement action case."""

    action_id: str
    source: str  # "SEC_LIT_RELEASE" | "SEC_ADMIN" | "FINRA_AWC" | "FINRA_DISC"
    entity_name: str  # Respondent (adviser firm or individual)
    action_date: str
    case_summary: str  # Full case description
    violations_found: list[str]  # Specific violations cited
    charges: list[str]  # Statutory charges (IA Act §206, etc.)
    penalty_usd: float  # Monetary penalty
    outcome: str  # "SETTLED" | "CONTESTED" | "DEFAULT"

    # Extracted for training pairs
    conduct_description: str = ""  # What the adviser actually did
    violation_explanation: str = ""  # Why it violated fiduciary duty
    corrective_action: str = ""  # What should have been done


@dataclass
class ViolationPair:
    """A training pair for fiduciary violation recognition."""

    pair_id: str
    prompt: str  # Description of adviser conduct (WITHOUT labels)
    response: str  # Explanation: what violated, why, and what should have happened
    action_id: str
    violation_types: list[str]
    severity: str  # "MINOR" | "MODERATE" | "SEVERE"


# Common fiduciary violation types (from IA Act §206)
VIOLATION_TAXONOMY = {
    "undisclosed_conflict": "Material conflict of interest not disclosed to clients",
    "excessive_fees": "Fees disproportionate to services provided, breaching duty of loyalty",
    "unsuitable_advice": "Advice unsuitable for client's financial situation and objectives",
    "churning": "Excessive trading to generate commissions without client benefit",
    "front_running": "Trading ahead of client orders for personal benefit",
    "misrepresentation": "False or misleading statements in client communications",
    "self_dealing": "Transactions benefiting adviser at client expense",
    "inadequate_disclosure": "Failure to disclose material information clients need to evaluate advice",
    "breach_of_duty_care": "Failure to exercise competence and diligence in providing advice",
    "unauthorized_trading": "Trades placed without client authorization or outside agreed strategy",
    "soft_dollar_abuse": "Using client commissions for adviser benefit beyond research and execution",
    "cherry_picking": "Favorable allocation of profitable trades to proprietary accounts",
}


class EnforcementActionCrawler:
    """
    Crawl and process enforcement actions from SEC and FINRA.

    Architecture:
    1. Fetch raw action text from SEC/FINRA public websites
    2. Parse: extract facts, charges, penalty
    3. Tag with violation taxonomy
    4. Convert to training pairs (for both SFT and GRPO reward signal)
    """

    RATE_LIMIT_DELAY = 0.15
    MAX_RETRIES = 3

    def __init__(
        self,
        output_dir: str = "data/raw/enforcement",
    ) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "FiduciaryOS Research calebnewtonusc@github.com",
                "Accept": "text/html,application/json",
            }
        )

    def crawl_sec_lit_releases(
        self,
        max_releases: int = 3000,
        start_year: int = 2000,
    ) -> int:
        """
        Crawl SEC Litigation Releases related to investment adviser violations.

        Lit releases describe SEC civil actions. IA cases are tagged with
        IA Act section references (§206(1), §206(2), §206(4)).

        Args:
            max_releases: Maximum number of releases to fetch.
            start_year: Only fetch releases from this year forward.

        Returns:
            Number of enforcement actions saved.
        """
        output_file = self.output_dir / "sec_lit_releases.jsonl"
        seen_file = self.output_dir / "sec_lit_seen_ids.txt"
        seen_ids: set[str] = set()
        if seen_file.exists():
            seen_ids = set(seen_file.read_text().splitlines())

        total_saved = 0

        # SEC lit releases are published as HTML pages, year-indexed
        for year in range(start_year, datetime.now().year + 1):
            if total_saved >= max_releases:
                break

            index_url = f"https://www.sec.gov/litigation/litreleases/{year}/"
            try:
                resp = self._get_with_retry(index_url)
                if not resp:
                    continue

                # Parse year index page for release links
                release_links = re.findall(
                    r'href="(/litigation/litreleases/(?:\d{4}/)?lr[\d]+\.htm)"',
                    resp.text,
                    re.IGNORECASE,
                )

                for rel_path in release_links:
                    if total_saved >= max_releases:
                        break
                    release_id = rel_path.split("/")[-1].replace(".htm", "")
                    if release_id in seen_ids:
                        continue

                    full_url = f"https://www.sec.gov{rel_path}"
                    release_resp = self._get_with_retry(full_url)
                    if not release_resp:
                        continue

                    action = self._parse_sec_lit_release(
                        release_id, release_resp.text, year
                    )
                    if action and self._is_ia_relevant(action):
                        with open(output_file, "a") as f:
                            f.write(json.dumps(asdict(action)) + "\n")
                        with open(seen_file, "a") as f:
                            f.write(release_id + "\n")
                        seen_ids.add(release_id)
                        total_saved += 1

                    time.sleep(self.RATE_LIMIT_DELAY)

            except Exception as e:
                logger.debug(f"SEC lit release error for year {year}: {e}")
                continue

            if total_saved % 200 == 0:
                logger.info(f"SEC lit releases: {total_saved} saved (year {year})")

        logger.info(f"SEC litigation release crawl complete: {total_saved} actions")
        return total_saved

    def crawl_finra_actions(
        self,
        max_actions: int = 5000,
    ) -> int:
        """
        Crawl FINRA disciplinary actions from the public monthly Excel files.

        FINRA publishes all AWC and disciplinary cases as downloadable
        monthly XLSX spreadsheets at:
          https://www.finra.org/rules-guidance/oversight-enforcement/finra-disciplinary-actions-online

        Each row = one case. Columns include:
          Case ID, Respondent, Firm Name, Action Type, Case Summary,
          Sanctions, Penalties, Effective Date.

        Args:
            max_actions: Maximum number of actions to fetch.

        Returns:
            Number of actions saved.
        """
        import io

        try:
            import openpyxl
        except ImportError:
            logger.error("openpyxl not installed — run: pip install openpyxl")
            return 0

        output_file = self.output_dir / "finra_actions.jsonl"
        seen_file = self.output_dir / "finra_seen_ids.txt"
        seen_ids: set[str] = set()
        if seen_file.exists():
            seen_ids = set(seen_file.read_text().splitlines())

        total_saved = 0

        # FINRA monthly XLSX pattern — confirmed working URLs
        monthly_file_pattern = (
            "https://www.finra.org/sites/default/files/fda_docs/"
            "FINRA_Disciplinary_Actions_{month}_{year}.xlsx"
        )

        current_year = datetime.now().year
        for year in range(2015, current_year + 1):
            if total_saved >= max_actions:
                break
            for month_num in range(1, 13):
                if total_saved >= max_actions:
                    break
                # Skip future months
                if year == current_year and month_num > datetime.now().month:
                    continue

                month_name = datetime(year, month_num, 1).strftime("%B")
                url = monthly_file_pattern.format(month=month_name, year=year)

                resp = self._get_with_retry(url)
                if not resp:
                    continue

                try:
                    wb = openpyxl.load_workbook(io.BytesIO(resp.content), read_only=True)
                    ws = wb.active
                    rows = list(ws.iter_rows(values_only=True))
                    if not rows:
                        continue

                    # First row is header
                    headers = [str(h).strip().lower() if h else "" for h in rows[0]]

                    def col(row, name_fragment: str) -> str:
                        for i, h in enumerate(headers):
                            if name_fragment in h and i < len(row):
                                return str(row[i] or "").strip()
                        return ""

                    for row in rows[1:]:
                        if total_saved >= max_actions:
                            break
                        case_id = col(row, "case") or f"finra_{year}_{month_num}_{total_saved}"
                        if case_id in seen_ids:
                            continue

                        respondent = col(row, "respondent") or col(row, "individual")
                        firm = col(row, "firm")
                        action_type = col(row, "action") or col(row, "type")
                        summary = col(row, "summary") or col(row, "description") or col(row, "detail")
                        sanctions = col(row, "sanction")
                        penalty_str = col(row, "fine") or col(row, "penalty") or col(row, "monetary")
                        effective_date = col(row, "date") or col(row, "effective")

                        if not summary or len(summary) < 80:
                            continue

                        # Parse penalty
                        penalty_usd = 0.0
                        penalty_clean = re.sub(r"[$,]", "", penalty_str)
                        try:
                            penalty_usd = float(penalty_clean)
                        except (ValueError, TypeError):
                            pass

                        # Determine violation types from summary
                        charges = self._extract_ia_charges(summary)
                        is_ia = self._is_ia_relevant_text(summary)

                        action = EnforcementAction(
                            action_id=f"finra_{case_id}",
                            source="FINRA_AWC",
                            entity_name=f"{respondent} / {firm}".strip(" /"),
                            action_date=effective_date,
                            case_summary=summary[:3000],
                            violations_found=[VIOLATION_TAXONOMY.get(c, c) for c in charges],
                            charges=charges,
                            penalty_usd=penalty_usd,
                            outcome="SETTLED" if action_type and "awc" in action_type.lower() else "CONTESTED",
                            conduct_description=self._extract_conduct_section(summary),
                            violation_explanation=self._build_violation_explanation(charges, summary),
                        )

                        if not is_ia and not charges:
                            continue  # Skip non-IA cases without detected charges

                        with open(output_file, "a") as f:
                            f.write(json.dumps(asdict(action)) + "\n")
                        with open(seen_file, "a") as f:
                            f.write(case_id + "\n")
                        seen_ids.add(case_id)
                        total_saved += 1

                    wb.close()

                except Exception as e:
                    logger.debug(f"FINRA XLSX parse error {month_name} {year}: {e}")

                time.sleep(self.RATE_LIMIT_DELAY)

                if total_saved % 500 == 0 and total_saved > 0:
                    logger.info(f"FINRA actions: {total_saved} saved (through {month_name} {year})")

        logger.info(f"FINRA actions crawl complete: {total_saved} actions")
        return total_saved

    def _is_ia_relevant_text(self, text: str) -> bool:
        """Check if raw text involves investment adviser fiduciary issues."""
        ia_keywords = [
            "investment adviser", "ia act", "§206", "section 206",
            "fiduciary", "investment advisory", "registered investment",
            "portfolio", "discretionary", "advisory fee",
        ]
        text_lower = text.lower()
        return any(kw in text_lower for kw in ia_keywords)

    def build_violation_pairs(
        self,
        input_dir: str = "data/raw/enforcement",
        output_file: str = "data/processed/violation_pairs.jsonl",
    ) -> int:
        """
        Convert enforcement action records into structured training pairs.

        Each enforcement action → 1-3 training pairs:
        1. Full analysis pair: describe conduct → full fiduciary analysis
        2. Detection pair: multiple descriptions → which violates
        3. Remedy pair: describe violation → suggest corrective action

        Args:
            input_dir: Directory containing raw enforcement action JSONL files.
            output_file: Output path for training pairs.

        Returns:
            Number of pairs generated.
        """
        input_path = Path(input_dir)
        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        total_pairs = 0
        source_files = list(input_path.glob("*.jsonl"))
        logger.info(f"Building violation pairs from {len(source_files)} source files")

        with open(output_path, "w") as out_f:
            for source_file in source_files:
                for line in source_file.read_text().splitlines():
                    if not line.strip():
                        continue
                    try:
                        action_dict = json.loads(line)
                        action = EnforcementAction(**action_dict)

                        pairs = self._action_to_pairs(action)
                        for pair in pairs:
                            out_f.write(json.dumps(asdict(pair)) + "\n")
                            total_pairs += 1

                    except (json.JSONDecodeError, TypeError) as e:
                        logger.debug(f"Could not parse action: {e}")
                        continue

        logger.info(
            f"Violation pair generation complete: {total_pairs} pairs from {len(source_files)} files"
        )
        return total_pairs

    def _action_to_pairs(self, action: EnforcementAction) -> list[ViolationPair]:
        """Convert an enforcement action to training pairs."""
        pairs: list[ViolationPair] = []

        if not action.conduct_description or len(action.conduct_description) < 100:
            return []

        # Pair 1: Full analysis
        prompt = (
            f"An investment adviser was subject to regulatory action. "
            f"The following conduct was described:\n\n"
            f"{action.conduct_description}\n\n"
            f"Analyze whether this conduct violates the adviser's fiduciary duty, "
            f"and explain any violations in detail."
        )
        response = f"{action.violation_explanation}\n\n"
        if action.corrective_action:
            response += (
                f"Appropriate conduct would have been: {action.corrective_action}"
            )

        if len(response) > 100:
            pairs.append(
                ViolationPair(
                    pair_id=f"{action.action_id}_analysis",
                    prompt=prompt,
                    response=response,
                    action_id=action.action_id,
                    violation_types=action.violations_found,
                    severity=self._assess_severity(action),
                )
            )

        # Pair 2: Detection (multiple choice format)
        if len(action.violations_found) >= 2:
            detection_prompt = (
                f"An investment adviser engaged in the following practice:\n\n"
                f"{action.conduct_description[:800]}\n\n"
                f"Which aspect of this conduct most directly violates the adviser's fiduciary duty?"
            )
            detection_response = (
                f"The most direct fiduciary violation is: {action.violations_found[0]}. "
                f"{action.violation_explanation[:500]}"
            )
            pairs.append(
                ViolationPair(
                    pair_id=f"{action.action_id}_detection",
                    prompt=detection_prompt,
                    response=detection_response,
                    action_id=action.action_id,
                    violation_types=action.violations_found[:1],
                    severity=self._assess_severity(action),
                )
            )

        return pairs

    def _assess_severity(self, action: EnforcementAction) -> str:
        """Estimate severity from penalty and charge types."""
        if action.penalty_usd >= 1_000_000:
            return "SEVERE"
        elif action.penalty_usd >= 100_000:
            return "MODERATE"
        else:
            return "MINOR"

    def _parse_sec_lit_release(
        self, release_id: str, html: str, year: int
    ) -> EnforcementAction | None:
        """Parse a SEC litigation release HTML page."""
        text = self._html_to_text(html)
        if len(text) < 200:
            return None

        # Extract entity name (usually in early paragraph)
        name_match = re.search(
            r"(?:against|charged|Commission|SEC)\s+([A-Z][A-Za-z\s,\.]+(?:LLC|Inc\.|Corp\.|LP|LLP|Ltd\.)?)",
            text[:1000],
        )
        entity_name = name_match.group(1).strip() if name_match else "Unknown"

        # Extract date
        date_match = re.search(
            r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b",
            text[:500],
        )
        action_date = date_match.group(0) if date_match else str(year)

        # Extract penalty
        penalty = self._extract_penalty(text)

        # Extract IA Act charges
        charges = self._extract_ia_charges(text)

        # Segment conduct description
        conduct = self._extract_conduct_section(text)
        violation_explanation = self._build_violation_explanation(charges, text)

        return EnforcementAction(
            action_id=f"sec_lr_{release_id}",
            source="SEC_LIT_RELEASE",
            entity_name=entity_name,
            action_date=action_date,
            case_summary=text[:3000],
            violations_found=[VIOLATION_TAXONOMY.get(c, c) for c in charges],
            charges=charges,
            penalty_usd=penalty,
            outcome="SETTLED" if "settled" in text.lower() else "CONTESTED",
            conduct_description=conduct,
            violation_explanation=violation_explanation,
        )

    def _is_ia_relevant(self, action: EnforcementAction) -> bool:
        """Check if action involves investment adviser fiduciary issues."""
        ia_keywords = [
            "investment adviser",
            "ia act",
            "§206",
            "section 206",
            "fiduciary",
            "investment advisory",
            "registered investment",
        ]
        text = action.case_summary.lower()
        return any(kw in text for kw in ia_keywords)

    def _extract_penalty(self, text: str) -> float:
        """Extract monetary penalty amount from enforcement text."""
        patterns = [
            r"\$([0-9,]+(?:\.\d+)?)\s*(?:million|M)\b",
            r"\$([0-9,]+(?:\.\d+)?)\s*(?:thousand|K)\b",
            r"pay\s+\$([0-9,]+(?:\.\d+)?)\b",
            r"disgorgement\s+of\s+\$([0-9,]+)\b",
        ]
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                amount_str = m.group(1).replace(",", "")
                amount = float(amount_str)
                group_lower = m.group(0).lower()
                if "million" in group_lower or re.search(r"\bm\b", group_lower):
                    amount *= 1_000_000
                elif "thousand" in group_lower or re.search(r"\bk\b", group_lower):
                    amount *= 1_000
                return amount
        return 0.0

    def _extract_ia_charges(self, text: str) -> list[str]:
        """Extract specific IA Act violation charges."""
        charges = []
        charge_patterns = {
            "undisclosed_conflict": r"§206\(2\)|section\s+206\(2\)|conflict\s+of\s+interest",
            "self_dealing": r"§206\(1\)|section\s+206\(1\)|self.dealing|self.interest",
            "misrepresentation": r"§206\(4\)|section\s+206\(4\)|misrepresent|false\s+statement",
            "churning": r"churning|excessive\s+trading|unnecessary\s+transaction",
            "unsuitable_advice": r"unsuitable|suitability\s+violation|not\s+in\s+best\s+interest",
        }
        text_lower = text.lower()
        for charge_type, pattern in charge_patterns.items():
            if re.search(pattern, text_lower):
                charges.append(charge_type)
        return charges

    def _extract_conduct_section(self, text: str) -> str:
        """Extract the factual description of the adviser's conduct."""
        # Look for common section headers in enforcement documents
        markers = [
            "The Commission alleges",
            "According to the complaint",
            "The complaint alleges",
            "Respondent",
            "The adviser",
        ]
        for marker in markers:
            idx = text.find(marker)
            if idx >= 0:
                return text[idx : idx + 1500].strip()
        return text[200:1700].strip()

    def _build_violation_explanation(self, charges: list[str], text: str) -> str:
        """Build a structured violation explanation from charges and case text."""
        if not charges:
            return ""
        explanations = []
        for charge in charges[:3]:  # Cap at 3 charges
            desc = VIOLATION_TAXONOMY.get(charge, charge)
            explanations.append(f"- {desc}")

        return (
            "This conduct violated the adviser's fiduciary duty under the Investment Advisers Act:\n"
            + "\n".join(explanations)
        )

    def _html_to_text(self, html: str) -> str:
        """Strip HTML tags and normalize whitespace."""
        html = re.sub(
            r"<(script|style)[^>]*>.*?</(script|style)>",
            "",
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"&(?:amp|lt|gt|nbsp|quot);", " ", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _get_with_retry(self, url: str) -> requests.Response | None:
        """HTTP GET with retry."""
        for attempt in range(self.MAX_RETRIES):
            try:
                resp = self.session.get(url, timeout=30)
                if resp.status_code == 200:
                    return resp
                elif resp.status_code == 429:
                    time.sleep(2 ** (attempt + 1))
                elif resp.status_code in (403, 404):
                    return None
                else:
                    time.sleep(1)
            except requests.RequestException as e:
                logger.debug(f"Request error (attempt {attempt + 1}): {e}")
                time.sleep(1)
        return None
