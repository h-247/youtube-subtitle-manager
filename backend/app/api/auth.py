from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserLogin, UserRead, Token
from app.services.auth_service import verify_password, get_password_hash, create_access_token
from app.api.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user_in.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists."
        )

    user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return UserRead(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        has_drive_connected=bool(user.drive_credentials),
        created_at=user.created_at,
    )


@router.post("/login", response_model=Token)
def login(user_in: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user or not verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    access_token = create_access_token(subject=user.id)
    user_read = UserRead(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        has_drive_connected=bool(user.drive_credentials),
        created_at=user.created_at,
    )

    return Token(
        access_token=access_token,
        token_type="bearer",
        user=user_read,
    )


@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user)):
    return UserRead(
        id=current_user.id,
        email=current_user.email,
        is_active=current_user.is_active,
        has_drive_connected=bool(current_user.drive_credentials),
        created_at=current_user.created_at,
    )


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    """
    Stateless JWT logout endpoint for frontend cleanup and session invalidation.
    """
    return {"message": "Logged out successfully"}
