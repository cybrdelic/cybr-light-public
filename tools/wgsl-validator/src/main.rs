// SPDX-License-Identifier: MIT
use std::{env, fs, path::Path, process};

fn main() {
    let mut paths = Vec::new();
    for argument in env::args().skip(1) {
        if Path::new(&argument).is_dir() {
            let entries = fs::read_dir(&argument).unwrap_or_else(|error| {
                eprintln!("FAIL {argument}: {error}");
                process::exit(1);
            });
            for entry in entries {
                let path = entry.expect("Unable to read shader directory entry").path();
                if path.extension().and_then(|extension| extension.to_str()) == Some("wgsl") {
                    paths.push(path.to_string_lossy().into_owned());
                }
            }
        } else {
            paths.push(argument);
        }
    }
    paths.sort();
    if paths.is_empty() {
        eprintln!("Usage: cybr-wgsl-validate <WGSL files or directory...>");
        process::exit(2);
    }
    let mut failed = false;
    for path in paths {
        let source = match fs::read_to_string(&path) {
            Ok(source) => source,
            Err(error) => {
                eprintln!("FAIL {path}: {error}");
                failed = true;
                continue;
            }
        };
        let module = match naga::front::wgsl::parse_str(&source) {
            Ok(module) => module,
            Err(error) => {
                eprintln!("FAIL {path}: {}", error.emit_to_string(&source));
                failed = true;
                continue;
            }
        };
        let mut validator = naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        );
        match validator.validate(&module) {
            Ok(_) => println!(
                "PASS {path}: Naga 30.0.1 parse/type validation, entries={}, functions={}, optional capabilities=none, GPU used=false",
                module.entry_points.len(),
                module.functions.len()
            ),
            Err(error) => {
                eprintln!("FAIL {path}: {}", error.emit_to_string(&source));
                failed = true;
            }
        }
    }
    if failed {
        process::exit(1);
    }
}
