mod api;
mod catalog;
mod history;
mod home;
mod library;
mod library_view;
mod manga;
mod pure;
mod reader;
mod reader_settings;
mod views;

fn main() {
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(views::App);
}
