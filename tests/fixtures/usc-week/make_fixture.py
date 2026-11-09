"""A BRIGHTSPACE_FIXTURE for tests/chewbacca_usc.sh: this term's ACAD-324
with one item due tomorrow, and last term's OLD-101, inactive, with one too.
Dates are relative to now so the week never goes stale."""
import datetime as d
import json
import sys

now = d.datetime.now(d.timezone.utc)


def iso(days):
    return (now + d.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


enrollments = {"Items": [{"OrgUnit": {"Id": 2, "Name": "20263_2 ACAD-324: Design", "Code": "20263_2"},
                          "Access": {"IsActive": True}},
                         {"OrgUnit": {"Id": 1, "Name": "20253_1 OLD-101: Last term", "Code": "20253_1"},
                          "Access": {"IsActive": False}}],
               "PagingInfo": {"HasMoreItems": False}}
with open(sys.argv[1], "w") as fh:
    json.dump({"/lp/1.63/enrollments/myenrollments/": enrollments,
               "/lp/1.43/enrollments/myenrollments/?orgUnitTypeId=3&pageSize=100": enrollments,
               "/le/1.99/2/calendar/events/myEvents/": {"Objects": [{"Title": "Mash Up", "StartDateTime": iso(1)}]},
               "/le/1.99/1/calendar/events/myEvents/": {"Objects": [{"Title": "Old thing", "StartDateTime": iso(1)}]}},
              fh)
