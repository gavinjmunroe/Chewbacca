//! chewbacca-sendpolicy: one send's facts on stdin, the policy's answer on
//! stdout.
//!
//!   chewbacca-sendpolicy --policy config/send-policy.cedar \
//!                        --schema config/send-policy.cedarschema < facts.json
//!   chewbacca-sendpolicy --policy P --schema S --validate
//!   chewbacca-sendpolicy --probe          prints "chewbacca-sendpolicy 1"
//!
//! Input:  {"action": "text" | "cold_email" | "clay_write", "context": {...}}
//!         The context's fields are typed by the schema; tools/send_policy.py
//!         gathers them.
//! Output: {"decision": "allow" | "deny", "rules": [{"id", "reason"}],
//!          "errors": [...]}
//!
//! Exit 0 allow, 3 deny, 2 when the policy, schema or input can't be read.
//!
//! Cedar skips a policy whose condition errors. For a forbid that would be a
//! silent allow, so any evaluation error here is a deny, and the policy is
//! validated strictly against the schema on every call (a misspelled field is
//! an error before anything is decided).

use cedar_policy::{
    Authorizer, Context, Decision, Entities, EntityUid, PolicySet, Request, Schema, ValidationMode,
    Validator,
};
use serde_json::{json, Value};
use std::io::Read;
use std::process::exit;
use std::str::FromStr;

fn fail(msg: String) -> ! {
    println!("{}", json!({"decision": "error", "rules": [], "errors": [msg]}));
    exit(2);
}

fn load(policy_path: &str, schema_path: &str) -> (PolicySet, Schema) {
    let psrc = std::fs::read_to_string(policy_path)
        .unwrap_or_else(|e| fail(format!("can't read {policy_path}: {e}")));
    let ssrc = std::fs::read_to_string(schema_path)
        .unwrap_or_else(|e| fail(format!("can't read {schema_path}: {e}")));
    let schema = match Schema::from_cedarschema_str(&ssrc) {
        Ok((s, _warnings)) => s,
        Err(e) => fail(format!("{schema_path}: {e}")),
    };
    let ps = PolicySet::from_str(&psrc).unwrap_or_else(|e| fail(format!("{policy_path}: {e}")));
    let v = Validator::new(schema.clone()).validate(&ps, ValidationMode::Strict);
    if !v.validation_passed() {
        let errs: Vec<String> = v.validation_errors().map(|e| e.to_string()).collect();
        fail(format!("{policy_path} doesn't match the schema: {}", errs.join("; ")));
    }
    (ps, schema)
}

fn uid(s: &str) -> EntityUid {
    EntityUid::from_str(s).unwrap_or_else(|e| fail(format!("bad entity {s}: {e}")))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--probe") {
        println!("chewbacca-sendpolicy 1");
        return;
    }
    let flag = |name: &str| -> String {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
            .unwrap_or_else(|| fail(format!("{name} is required")))
    };
    let (ps, schema) = load(&flag("--policy"), &flag("--schema"));
    if args.iter().any(|a| a == "--validate") {
        println!("{}", json!({"ok": true, "policies": ps.policies().count()}));
        return;
    }

    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .unwrap_or_else(|e| fail(format!("stdin: {e}")));
    let input: Value = serde_json::from_str(&raw).unwrap_or_else(|e| fail(format!("stdin isn't JSON: {e}")));
    let action_name = input
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_else(|| fail("no action".into()));
    let action = uid(&format!("Action::{}", Value::String(action_name.into())));
    let context = Context::from_json_value(
        input.get("context").cloned().unwrap_or(json!({})),
        Some((&schema, &action)),
    )
    .unwrap_or_else(|e| fail(format!("context: {e}")));
    let request = Request::new(
        uid(r#"Agent::"kit""#),
        action,
        uid(r#"Message::"this""#),
        context,
        Some(&schema),
    )
    .unwrap_or_else(|e| fail(format!("request: {e}")));

    let resp = Authorizer::new().is_authorized(&request, &ps, &Entities::empty());
    let errors: Vec<String> = resp.diagnostics().errors().map(|e| e.to_string()).collect();
    let rules: Vec<Value> = resp
        .diagnostics()
        .reason()
        .filter_map(|id| ps.policy(id))
        .filter(|p| p.effect() == cedar_policy::Effect::Forbid)
        .map(|p| {
            json!({
                "id": p.annotation("id").unwrap_or(p.id().as_ref()),
                "reason": p.annotation("reason").unwrap_or(""),
            })
        })
        .collect();
    let allow = resp.decision() == Decision::Allow && errors.is_empty();
    println!(
        "{}",
        json!({"decision": if allow { "allow" } else { "deny" }, "rules": rules, "errors": errors})
    );
    exit(if allow { 0 } else { 3 });
}
