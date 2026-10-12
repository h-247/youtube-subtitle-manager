from fastapi import status


def test_register_success(client):
    response = client.post(
        "/api/auth/register",
        json={"email": "newuser@example.com", "password": "securepassword123"},
    )
    assert response.status_code == status.HTTP_201_CREATED
    data = response.json()
    assert data["email"] == "newuser@example.com"
    assert "id" in data
    assert data["is_active"] is True


def test_register_duplicate_email(client, user_a):
    response = client.post(
        "/api/auth/register",
        json={"email": user_a.email, "password": "anotherpassword"},
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "already exists" in response.json()["detail"]


def test_login_success(client, user_a):
    response = client.post(
        "/api/auth/login",
        json={"email": user_a.email, "password": "password123"},
    )
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == user_a.email


def test_login_invalid_password(client, user_a):
    response = client.post(
        "/api/auth/login",
        json={"email": user_a.email, "password": "wrongpassword"},
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_login_nonexistent_user(client):
    response = client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "password123"},
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_get_current_user_me(client, user_a, user_a_headers):
    response = client.get("/api/auth/me", headers=user_a_headers)
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["id"] == user_a.id
    assert data["email"] == user_a.email


def test_get_me_unauthorized(client):
    response = client.get("/api/auth/me")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_logout(client, user_a_headers):
    response = client.post("/api/auth/logout", headers=user_a_headers)
    assert response.status_code == status.HTTP_200_OK
    assert response.json()["message"] == "Logged out successfully"
