import React, { useState, useEffect, useRef } from "react";
import { Container, Form, Button, Alert } from "react-bootstrap";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import "./signup.css";

const SignupTwoForm = () => {
  const userId = localStorage.getItem("userId");
  const apiUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000'; // Fallback URL for development
  const [formData, setFormData] = useState({
    otp: ["", "", "", "", "", ""],
    password: "",
    confirmPassword: "",
    userId: userId,
  });

  const [errors, setErrors] = useState({});
  const [signupError, setSignupError] = useState("");
  const [timer, setTimer] = useState(300); // 5 minutes in seconds
  const [showResendButton, setShowResendButton] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const navigate = useNavigate();
  const otpInputs = useRef([]);

  useEffect(() => {
    if (!userId) {
      navigate("/signuptwo");
    }

    const countdown = setInterval(() => {
      setTimer((prevTimer) => {
        if (prevTimer === 0) {
          clearInterval(countdown);
          setShowResendButton(true);
          return 0;
        }
        return prevTimer - 1;
      });
    }, 1000);

    return () => clearInterval(countdown);
  }, [userId, navigate]);

  const handleChange = (e, index) => {
    const { value } = e.target;
    if (value.length <= 1 && /^\d*$/.test(value)) {
      const newOtp = [...formData.otp];
      newOtp[index] = value;
      setFormData({
        ...formData,
        otp: newOtp,
      });
      if (value.length === 1 && index < 5) {
        otpInputs.current[index + 1].focus();
      }
    } else if (value.length === 0 && index > 0) {
      otpInputs.current[index - 1].focus();
    }
    setSignupError("");
    setErrors((prevErrors) => ({ ...prevErrors, otp: "" }));
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Backspace' && index > 0 && formData.otp[index] === '') {
      e.preventDefault();
      const newOtp = [...formData.otp];
      newOtp[index - 1] = '';
      setFormData({
        ...formData,
        otp: newOtp,
      });
      otpInputs.current[index - 1].focus();
    }
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
    setSignupError("");
    setErrors((prevErrors) => ({ ...prevErrors, [name]: "" }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (formData.otp.join("").length !== 6) newErrors.otp = "OTP must be 6 digits";
    if (!formData.password) newErrors.password = "Password is required";
    if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = "Passwords do not match";
    if (formData.password.length < 8) newErrors.password = "Password must be at least 8 characters long";
    
    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const formErrors = validateForm();
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
      return;
    }
    try {
      const response = await axios.post(`${apiUrl}/api/signuptwo`, {
        ...formData,
        otp: formData.otp.join(""),
      });
      if (response.status === 200) {
        navigate("/signupthree");
      }
    } catch (error) {
      console.error("There was an error submitting the form!", error);
      if (error.response) {
        setSignupError(`Server error: ${error.response.data.message || 'Unknown error'}`);
      } else if (error.request) {
        setSignupError("No response from server. Please check your internet connection.");
      } else {
        setSignupError("An error occurred. Please try again later.");
      }
    }
  };

  const handleResendOTP = async () => {
    if (showResendButton) {
      try {
        const response = await axios.post(`${apiUrl}/api/resend-otp`, { userId });
        if (response.status === 200) {
          setResendMessage("New OTP sent successfully!");
          setTimer(300);
          setShowResendButton(false);
        }
      } catch (error) {
        console.error("Error resending OTP:", error);
        setResendMessage("Failed to resend OTP. Please try again.");
      }
    }
  };

  return ( 
    <Container className="d-flex justify-content-center align-items-center signup min-vh-100">
      <Form onSubmit={handleSubmit} className="d-flex flex-column align-items-center login-page p-4" style={{ width: "100%", maxWidth: "400px" }}>
        <h2 className="text-center login-heading mb-4">Privacy Part</h2>
        <p className="text-center w-100 mb-4 detail">
          Please Enter Your Details 
        </p>
        {signupError && <Alert variant="danger" className="w-100 mb-3">{signupError}</Alert>}
        {resendMessage && <Alert variant="info" className="w-100 mb-3">{resendMessage}</Alert>}
        
        <Form.Group controlId="formOtp" className="w-100 mb-3">
          <Form.Label>Enter OTP</Form.Label>
          <div className="d-flex justify-content-between">
            {formData.otp.map((digit, index) => (
              <Form.Control
                key={index}
                type="text"
                maxLength="1"
                value={digit}
                onChange={(e) => handleChange(e, index)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                ref={(el) => (otpInputs.current[index] = el)}
                style={{ width: "40px", textAlign: "center" }}
                isInvalid={!!errors.otp}
              />
            ))}
          </div>
          <Form.Control.Feedback type="invalid">{errors.otp}</Form.Control.Feedback>
        </Form.Group>
        <div className="w-100 mb-3 d-flex justify-content-between align-items-center">
          <span>{Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}</span>
          <Button 
            variant="link" 
            onClick={handleResendOTP} 
            disabled={!showResendButton}
            style={{
              opacity: showResendButton ? 1 : 0.5,
              cursor: showResendButton ? 'pointer' : 'not-allowed',
              pointerEvents: showResendButton ? 'auto' : 'none'
            }}
          >
            Resend OTP
          </Button>
        </div>
        <Form.Group controlId="formBasicPassword" className="w-100 mb-3">
          <Form.Control type="password" name="password" placeholder="Enter Password" value={formData.password} onChange={handlePasswordChange} isInvalid={!!errors.password} />
          <Form.Control.Feedback type="invalid">{errors.password}</Form.Control.Feedback>
        </Form.Group>
        <Form.Group controlId="formConfirmPassword" className="w-100 mb-3">
          <Form.Control type="password" name="confirmPassword" placeholder="Confirm Password" value={formData.confirmPassword} onChange={handlePasswordChange} isInvalid={!!errors.confirmPassword} />
          <Form.Control.Feedback type="invalid">{errors.confirmPassword}</Form.Control.Feedback>
        </Form.Group>
        <Button variant="primary" type="submit" className="submitbtn w-100 mb-4">
          Next
        </Button>
        <p className="text-center w-100 bottom-tag">
          Already have an account? <Link className="tag-name" to="/login" style={{ textDecoration: "none" }}><b>Log In</b></Link>
        </p>
      </Form>
    </Container>
  );
};

export default SignupTwoForm;
