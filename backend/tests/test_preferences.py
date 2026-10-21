from app.services import sites_sync_service as sync


def test_prompt_link_clear_from_site_is_not_resurrected(client, user_a, user_a_headers, db_session, monkeypatch):
    user_a.sites_sync_token = sync.encrypt_token("paired-token")
    user_a.chatgpt_prompt_link = "https://chatgpt.com/c/old"
    db_session.commit()
    monkeypatch.setattr("app.api.preferences.get_prompt_link", lambda token: None)
    def unexpected_write(*args):
        raise AssertionError("Reading a cleared preference must not write it back")
    monkeypatch.setattr("app.api.preferences.set_prompt_link", unexpected_write)
    response = client.get("/api/preferences/prompt-link", headers=user_a_headers)
    assert response.status_code == 200
    assert response.json() == {"chatgpt_prompt_link": None}
    db_session.refresh(user_a)
    assert user_a.chatgpt_prompt_link is None
