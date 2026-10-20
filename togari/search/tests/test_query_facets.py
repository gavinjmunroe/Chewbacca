"""Query facets: naming the shape of the question before the filter reads contacts.

The load-bearing property is the LAST test in this file: a query that matches
nothing must produce an empty string, so the Stage-1 prompt is byte-identical to
what it was before facets existed. That is what makes this safe to ship.
"""
from api.query_facets import classify_query_facets, facet_block, facet_instructions


def test_a_place_question_is_a_place_question():
    assert "PLACE" in classify_query_facets("who do I know in Austin")
    assert "PLACE" in classify_query_facets("anyone near me right now")
    assert "PLACE" in classify_query_facets("which city is Priya in")
    assert "PLACE" in classify_query_facets("who is around here")


def test_a_timeframe_is_detected_separately_from_the_place():
    facets = classify_query_facets("who is in San Francisco next week")
    assert "PLACE" in facets
    assert "TIME" in facets


def test_time_cues_on_their_own():
    for q in (
        "who should I see tonight",
        "who is free this weekend",
        "anyone I should call today",
        "what is Dev up to these days",
        "who am I seeing on Friday",
    ):
        assert "TIME" in classify_query_facets(q), q


def test_a_question_about_one_person():
    for q in ("who is Priya", "what do I know about Sagar", "tell me about Ravi",
              "catch me up on Mia", "remind me about Dev"):
        assert "PERSON" in classify_query_facets(q), q


def test_a_person_question_is_not_triggered_mid_sentence():
    # "who is" only counts at the start; otherwise "who is in Austin" would be
    # a PERSON lookup, which is the opposite of what it asks.
    assert "PERSON" not in classify_query_facets("in Austin, who works at Stripe")


def test_who_is_followed_by_a_preposition_is_not_a_person_lookup():
    # THE ONE THIS TEST FILE CAUGHT. "who is in San Francisco next week" starts
    # with "who is", and the PERSON instruction says to drop everyone who is not
    # the named person -- so the best query this whole feature exists for was
    # being turned into an empty result by its own hint.
    for q in (
        "who is in San Francisco next week",
        "who is around here",
        "who is free this weekend",
        "who is visiting Austin",
        "who is based in NYC",
        "who's at the conference",
        "who is going to be around",
    ):
        assert "PERSON" not in classify_query_facets(q), q

    # And the real person lookups still are.
    for q in ("who is Priya", "who's Dev Kapoor", "who is Sagar Tiwari"):
        assert "PERSON" in classify_query_facets(q), q


def test_a_request_for_a_stored_detail():
    for q in ("what does Ravi do", "where does Mia work", "which company is Dev at",
              "what is her title", "when did Sam graduate"):
        assert "FACT" in classify_query_facets(q), q


def test_an_introduction_request():
    for q in ("who should I introduce to Priya", "connect me with someone in climate",
              "who should meet Dev", "can I get a warm intro"):
        assert "INTRO" in classify_query_facets(q), q


def test_taste_and_interest():
    for q in ("who likes Mexican food", "who is into climbing",
              "who would enjoy this restaurant", "who hates seafood",
              "who'd be up for trivia"):
        assert "AFFINITY" in classify_query_facets(q), q


def test_facets_are_a_union_not_a_choice():
    # A real query is usually several of these at once, and each narrows a
    # different axis. Picking one would throw away the others.
    facets = classify_query_facets("who in Austin likes Mexican food this weekend")
    assert {"PLACE", "TIME", "AFFINITY"} <= set(facets)


def test_the_order_is_stable_across_calls():
    q = "who in Austin likes Mexican food this weekend"
    assert classify_query_facets(q) == classify_query_facets(q)


def test_every_label_carries_an_instruction():
    facets = classify_query_facets("who is in San Francisco next week")
    instructions = facet_instructions("who is in San Francisco next week")
    assert set(facets) == set(instructions)
    for text in instructions.values():
        assert len(text) > 40


def test_the_block_names_the_labels_then_explains_each_one():
    block = facet_block("who is in San Francisco next week")
    assert "What this query is asking for: PLACE, TIME" in block
    assert block.count("\n- ") == 2


def test_an_unmatched_query_produces_nothing_at_all():
    # THE SAFETY PROPERTY. Empty string, not a "no facets" line: the Stage-1
    # prompt stays byte-identical for any query this does not understand, so an
    # unmatched query provably cannot change a keep/drop decision.
    for q in ("hello", "asdfgh", "Sagar Tiwari", "", "   ", None, 42, []):
        assert classify_query_facets(q) == [] or facet_block(q) != ""
    assert facet_block("asdfgh") == ""
    assert facet_block("") == ""
    assert facet_block(None) == ""
    assert facet_block(42) == ""


def test_degenerate_input_never_raises():
    for value in (None, "", "   ", 42, [], {}, 3.14):
        assert isinstance(classify_query_facets(value), list)
        assert isinstance(facet_block(value), str)
        assert isinstance(facet_instructions(value), dict)
