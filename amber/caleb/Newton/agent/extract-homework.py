#!/usr/bin/env python3
"""
Extract homework from calendar JSON and create Todoist tasks
"""

import json
import os
import requests
from datetime import datetime, timedelta

TODOIST_API_KEY = os.environ.get('TODOIST_API_KEY', '')

def main():
    print("[calendar] Extracting homework from calendar...\n")

    # Read calendar data
    with open('/Users/joelnewton/Desktop/2026-Code/_System/poke-agent-cloud/calendar-events.json', 'r') as f:
        data = json.load(f)

    events = data.get('data', {}).get('items', [])
    print(f"Found {len(events)} total calendar events\n")

    # Filter homework events
    homework_events = []
    for event in events:
        summary = event.get('summary', '').lower()
        if any(keyword in summary for keyword in ['hw', 'homework', 'assignment']) and 'club' not in summary:
            homework_events.append(event)

    print(f"Found {homework_events.length} homework events:\n")
    for event in homework_events:
        print(f"  - {event.get('summary')} ({event.get('start', {}).get('date') or event.get('start', {}).get('dateTime', '').split('T')[0]})")

    # Get Todoist projects
    projects_response = requests.get(
        'https://api.todoist.com/rest/v2/projects',
        headers={'Authorization': f'Bearer {TODOIST_API_KEY}'}
    )
    projects = projects_response.json()
    project_map = {p['name']: p['id'] for p in projects}

    # Get existing tasks to avoid duplicates
    tasks_response = requests.get(
        'https://api.todoist.com/rest/v2/tasks',
        headers={'Authorization': f'Bearer {TODOIST_API_KEY}'}
    )
    existing_tasks = tasks_response.json()
    existing_content = {t['content'].lower() for t in existing_tasks}

    # Process homework events
    created_count = 0
    skipped_count = 0

    for event in homework_events:
        summary = event.get('summary', '')

        # Get due date
        due_date = event.get('end', {}).get('date') or event.get('start', {}).get('date')
        if not due_date:
            dt = event.get('end', {}).get('dateTime') or event.get('start', {}).get('dateTime')
            if dt:
                due_date = dt.split('T')[0]

        if not due_date:
            continue

        # Determine project
        project_id = None
        content = summary

        if 'math 226' in summary.lower() or 'calc' in summary.lower():
            project_id = project_map.get('MATH 226 - Calculus')
            content = summary.replace('MATH 226 ', '').replace('Calc ', '')
        elif 'math 225' in summary.lower() or 'linear' in summary.lower():
            project_id = project_map.get('MATH 225 - Linear Algebra')
            content = summary.replace('MATH 225 ', '').replace('Linear Algebra ', '')
        elif 'csci 103' in summary.lower() or 'c++' in summary.lower():
            project_id = project_map.get('CSCI 103 - C++')
            content = summary.replace('CSCI 103 ', '').replace('C++ ', '')
        elif 'csci 170' in summary.lower() or 'discrete' in summary.lower():
            project_id = project_map.get('CSCI 170 - Discrete Methods')
            content = summary.replace('CSCI 170 ', '').replace('Discrete Methods ', '')

        if not project_id:
            continue

        # Check for duplicates
        if content.lower() in existing_content:
            print(f"   [forward.fill]  Skipping duplicate: {content}")
            skipped_count += 1
            continue

        # Calculate work date (2 days before due for homework)
        due_dt = datetime.strptime(due_date, '%Y-%m-%d')
        work_dt = due_dt - timedelta(days=2)
        work_date = work_dt.strftime('%Y-%m-%d')

        # Determine sprint for work date
        day = work_dt.weekday()  # 0=Mon, 6=Sun
        if day == 0:  # Monday
            sprint = 'Sprint 1'
        elif day in [1, 2]:  # Tue-Wed
            sprint = 'Sprint 2'
        elif day in [3, 4]:  # Thu-Fri
            sprint = 'Sprint 3'
        else:  # Sat-Sun
            sprint = 'Sprint 4'

        # Create task
        task_data = {
            'content': content,
            'due_date': work_date,
            'project_id': project_id,
            'priority': 2,  # P3 by default
            'labels': ['More thinking', sprint]
        }

        response = requests.post(
            'https://api.todoist.com/rest/v2/tasks',
            headers={
                'Authorization': f'Bearer {TODOIST_API_KEY}',
                'Content-Type': 'application/json'
            },
            json=task_data
        )

        if response.ok:
            print(f"   [checkmark.circle] {work_date} [{sprint}] {content}")
            created_count += 1
        else:
            print(f"   [xmark.circle] Failed: {content} - {response.text}")

    print(f"\n[checkmark.circle] Created {created_count} homework tasks")
    print(f"[forward.fill]  Skipped {skipped_count} duplicates")

if __name__ == '__main__':
    main()
