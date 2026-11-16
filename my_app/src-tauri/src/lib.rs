mod config;
mod csv_io;
mod db;
mod engine_proc;
mod error;
mod groq_agent;
mod scraper_api;

use engine_proc::{stop_managed_process, EngineState};
use tauri::{Manager, RunEvent};

#[tauri::command]
fn app_health_ping() -> &'static str {
    "ok"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(EngineState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            app_health_ping,
            config::get_settings,
            config::save_desktop_settings,
            config::set_groq_api_key,
            config::clear_groq_api_key,
            config::test_groq_connection,
            engine_proc::get_engine_status,
            engine_proc::start_engine,
            engine_proc::stop_engine,
            engine_proc::restart_engine,
            engine_proc::read_engine_logs,
            db::list_db_jobs,
            db::delete_db_job,
            db::clear_db_jobs,
            csv_io::list_csv_files,
            csv_io::read_csv_table,
            csv_io::export_csv_file,
            csv_io::open_file_externally,
            csv_io::reveal_file_in_folder,
            scraper_api::list_business_types,
            scraper_api::lookup_city,
            scraper_api::get_job_status,
            scraper_api::start_scrape_job,
            scraper_api::restart_db_job,
            scraper_api::run_social_lookup,
            scraper_api::run_website_enrich,
            groq_agent::chat_with_groq,
            groq_agent::load_chat_history,
            groq_agent::save_chat_history,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let state = app_handle.state::<EngineState>();
            stop_managed_process(&state);
        }
    });
}
