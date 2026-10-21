import unittest

from perplexity_code.router import classify_task, route_task, should_use_discovery


class ClassifyTaskTests(unittest.TestCase):
    def test_discovery_tasks(self):
        self.assertEqual(classify_task("find the best React state management library"), "discovery")
        self.assertEqual(classify_task("search for authentication starter repos"), "discovery")
        self.assertEqual(classify_task("what is the latest version of Next.js"), "discovery")

    def test_debugging_tasks(self):
        self.assertEqual(classify_task("fix the null error in auth"), "debugging")
        self.assertEqual(classify_task("debug why the API is failing"), "debugging")

    def test_generation_tasks(self):
        self.assertEqual(classify_task("create a user dashboard component"), "generation")
        self.assertEqual(classify_task("build the settings page"), "generation")

    def test_review_tasks(self):
        self.assertEqual(classify_task("review this code for security issues"), "review")
        self.assertEqual(classify_task("audit the database queries"), "review")


class RouteTaskTests(unittest.TestCase):
    def test_discovery_enables_search(self):
        route = route_task("find the best auth library for Next.js")
        self.assertTrue(route["search_enabled"])
        self.assertEqual(route["task_type"], "discovery")

    def test_generation_disables_search(self):
        route = route_task("create a new API route for users")
        self.assertFalse(route["search_enabled"])

    def test_command_override(self):
        route = route_task("some task", command="debug")
        self.assertEqual(route["task_type"], "debugging")

    def test_should_use_discovery(self):
        self.assertTrue(should_use_discovery("find a good ORM library"))
        self.assertFalse(should_use_discovery("fix the login page"))


if __name__ == "__main__":
    unittest.main()
